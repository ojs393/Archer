import type { DatabaseSync } from "node:sqlite";
import { estimateSchedule, localDateKey, type Estimate, type Schedule } from "../domain/schedule.ts";
import type { CampaignCounts, CampaignView } from "../http/contract.ts";
import type { CampaignStatus } from "../send/sendState.ts";

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
  schedule_json: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
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

export function getCampaignView(db: DatabaseSync, campaignId: number, now: Date = new Date()): CampaignView | null {
  const row = db
    .prepare(
      `SELECT id, list_id, template_id, template_version, status, pause_reason, schedule_json, created_at, started_at, finished_at
       FROM campaigns WHERE id = ?`,
    )
    .get(campaignId) as CampaignDbRow | undefined;
  if (!row) return null;
  const schedule = parseSchedule(row.schedule_json);
  const counts = campaignCounts(db, row.id);
  return {
    id: row.id,
    listId: row.list_id,
    templateId: row.template_id,
    templateVersion: row.template_version,
    status: row.status,
    pauseReason: row.pause_reason,
    schedule,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    counts,
    estimate: campaignEstimate(db, row.id, schedule, counts.pending + counts.retry + counts.sending, now),
    stats: campaignStats(db, row.id, now),
  };
}
