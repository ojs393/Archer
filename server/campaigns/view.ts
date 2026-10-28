import type { DatabaseSync } from "node:sqlite";
import { estimateSchedule, localDateKey, type Estimate, type Schedule } from "../domain/schedule.ts";
import type { CampaignCounts, CampaignView } from "../http/contract.ts";
import type { CampaignStatus } from "../send/sendState.ts";
import { listTagsForCampaign, resolveTagId, setCampaignTags } from "../tags/store.ts";

const STATES = ["pending", "sending", "sent", "retry", "failed", "uncertain", "skipped_suppressed"] as const;
const REJECTION_WINDOW = 200;
const HOUR_MS = 3_600_000;

interface CampaignDbRow {
  id: number;
  list_id: number;
  template_id: number;
  template_version: number;
  status: CampaignStatus;
  pause_reason: string | null;
  title: string | null;
  schedule_json: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  list_name: string;
  template_name: string;
}

export function campaignCounts(db: DatabaseSync, campaignId: number): CampaignCounts {
  const counts: CampaignCounts = { pending: 0, sending: 0, sent: 0, retry: 0, failed: 0, uncertain: 0, skipped_suppressed: 0, total: 0 };
  const rows = db.prepare("SELECT state, COUNT(*) AS n FROM sends WHERE campaign_id = ? GROUP BY state").all(campaignId) as {
    state: (typeof STATES)[number];
    n: number;
  }[];
  for (const { state, n } of rows) {
    if (state in counts) counts[state] = n;
    counts.total += n;
  }
  return counts;
}

function campaignStats(db: DatabaseSync, campaignId: number, now: Date): CampaignView["stats"] {
  const { n } = db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE campaign_id = ? AND type = 'sent' AND created_at >= ?")
    .get(campaignId, new Date(now.getTime() - HOUR_MS).toISOString()) as { n: number };
  const outcomes = db
    .prepare(
      `SELECT type FROM events WHERE campaign_id = ? AND type IN ('sent','failed','suppressed')
       ORDER BY id DESC LIMIT ?`,
    )
    .all(campaignId, REJECTION_WINDOW) as { type: string }[];
  const rejections = outcomes.filter((o) => o.type !== "sent").length;
  return { sentLastHour: n, rejectionRate: outcomes.length ? rejections / outcomes.length : 0, sample: outcomes.length };
}

const UNREADABLE_SCHEDULE: Estimate = {
  perDay: [],
  completionDate: null,
  totalDays: 0,
  perDayCapacityNote: "The saved schedule is unreadable; set the schedule again.",
};

function parseSchedule(json: string): Schedule | null {
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Schedule) : null;
  } catch {
    return null;
  }
}

function campaignEstimate(db: DatabaseSync, id: number, schedule: Schedule | null, remaining: number, now: Date): Estimate {
  if (!schedule) return { ...UNREADABLE_SCHEDULE, perDay: [] };
  try {
    const today = localDateKey(now, schedule.timezone);
    const sentToday =
      (db.prepare("SELECT sent FROM campaign_days WHERE campaign_id = ? AND day = ?").get(id, today) as { sent: number } | undefined)?.sent ?? 0;
    const { n } = db
      .prepare("SELECT COUNT(*) AS n FROM campaign_days WHERE campaign_id = ? AND day < ? AND sent > 0")
      .get(id, today) as { n: number };
    return estimateSchedule({ remaining, schedule, now, sentToday, sendDayIndex: n });
  } catch {
    return { perDay: [], completionDate: null, totalDays: 0, perDayCapacityNote: "The schedule could not be estimated; check it." };
  }
}

function toView(db: DatabaseSync, row: CampaignDbRow, now: Date): CampaignView {
  const schedule = parseSchedule(row.schedule_json);
  const counts = campaignCounts(db, row.id);
  const title = row.title?.trim() ? row.title.trim() : null;
  const tags = listTagsForCampaign(db, row.id);
  const fallback = `${row.list_name} · ${row.template_name}`;
  return {
    id: row.id,
    listId: row.list_id,
    templateId: row.template_id,
    templateVersion: row.template_version,
    status: row.status,
    pauseReason: row.pause_reason,
    title,
    tags,
    displayName: title ?? fallback,
    listName: row.list_name,
    templateName: row.template_name,
    schedule,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    counts,
    estimate: campaignEstimate(db, row.id, schedule, counts.pending + counts.retry + counts.sending, now),
    stats: campaignStats(db, row.id, now),
  };
}

const VIEW_SELECT = `SELECT c.id, c.list_id, c.template_id, c.template_version, c.status, c.pause_reason, c.title,
        c.schedule_json, c.created_at, c.started_at, c.finished_at,
        l.name AS list_name, t.name AS template_name
     FROM campaigns c
     JOIN lists l ON l.id = c.list_id
     JOIN templates t ON t.id = c.template_id`;

export function getCampaignView(db: DatabaseSync, campaignId: number, now: Date = new Date()): CampaignView | null {
  const row = db.prepare(`${VIEW_SELECT} WHERE c.id = ?`).get(campaignId) as CampaignDbRow | undefined;
  return row ? toView(db, row, now) : null;
}

export type CampaignSort = "id" | "created_at" | "status" | "title";
export type SortOrder = "asc" | "desc";

export interface CampaignListQuery {
  q?: string;
  status?: string;
  tag?: string;
  sort?: CampaignSort;
  order?: SortOrder;
}

const STATUS_SET = new Set([
  "draft",
  "running",
  "paused",
  "waiting_window",
  "waiting_network",
  "safety_stop",
  "completed",
  "stopped",
]);

export function listCampaignViews(db: DatabaseSync, query: CampaignListQuery = {}, now: Date = new Date()): CampaignView[] {
  const where: string[] = [];
  const params: unknown[] = [];
  const q = query.q?.trim();
  if (q) {
    where.push(
      `(IFNULL(c.title,'') LIKE ? ESCAPE '\\' OR l.name LIKE ? ESCAPE '\\' OR t.name LIKE ? ESCAPE '\\')`,
    );
    const like = `%${q.replace(/([%_\\])/g, "\\$1")}%`;
    params.push(like, like, like);
  }
  if (query.status?.trim()) {
    const statuses = query.status
      .split(",")
      .map((s) => s.trim())
      .filter((s) => STATUS_SET.has(s));
    if (statuses.length === 0) return [];
    where.push(`c.status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }
  if (query.tag?.trim()) {
    const tagId = resolveTagId(db, query.tag);
    if (tagId === null) return [];
    where.push("c.id IN (SELECT campaign_id FROM campaign_tags WHERE tag_id = ?)");
    params.push(tagId);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sort = query.sort ?? "id";
  const order = query.order === "asc" ? "ASC" : "DESC";
  const sortCol =
    sort === "created_at"
      ? "c.created_at"
      : sort === "status"
        ? "c.status"
        : sort === "title"
          ? "IFNULL(c.title, l.name || ' · ' || t.name) COLLATE NOCASE"
          : "c.id";
  const rows = db.prepare(`${VIEW_SELECT} ${whereSql} ORDER BY ${sortCol} ${order}`).all(...(params as never[])) as unknown as CampaignDbRow[];
  return rows.map((r) => toView(db, r, now));
}

export function updateCampaignMeta(
  db: DatabaseSync,
  campaignId: number,
  patch: { title?: string | null; tags?: string[] },
): CampaignView | null {
  if (!db.prepare("SELECT 1 FROM campaigns WHERE id = ?").get(campaignId)) return null;
  if (patch.title !== undefined) {
    const raw = patch.title ?? "";
    const title = raw.trim() === "" ? null : raw.trim();
    db.prepare("UPDATE campaigns SET title = ? WHERE id = ?").run(title, campaignId);
  }
  if (patch.tags !== undefined) setCampaignTags(db, campaignId, patch.tags);
  return getCampaignView(db, campaignId);
}
