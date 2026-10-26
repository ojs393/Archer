import type { DatabaseSync } from "node:sqlite";
import type { AnalyticsRun, AnalyticsRuns } from "../http/contract.ts";
import type { CampaignStatus } from "../send/sendState.ts";
import { campaignTotals, deliveryRate } from "./outcomes.ts";

export const MAX_RUNS = 100;

interface RunRow {
  id: number;
  status: CampaignStatus;
  started_at: string | null;
  finished_at: string | null;
  list_name: string | null;
  template_name: string | null;
  list_id: number;
  template_id: number;
}

const RUNS_SQL = `
  SELECT c.id, c.status, c.started_at, c.finished_at, c.list_id, c.template_id, l.name AS list_name, t.name AS template_name
  FROM campaigns c
  LEFT JOIN lists l ON l.id = c.list_id
  LEFT JOIN templates t ON t.id = c.template_id`;

function toRun(db: DatabaseSync, r: RunRow): AnalyticsRun {
  const totals = campaignTotals(db, r.id);
  return {
    id: r.id,
    name: `${r.list_name ?? `List ${r.list_id}`} · ${r.template_name ?? `Template ${r.template_id}`}`,
    status: r.status,
    recipients: totals.recipients,
    sent: totals.sent,
    failed: totals.failed,
    suppressed: totals.suppressed,
    uncertain: totals.uncertain,
    deliveryRate: deliveryRate(totals),
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export function analyticsRuns(db: DatabaseSync, campaignId: number | null): AnalyticsRuns {
  const rows =
    campaignId === null
      ? (db.prepare(`${RUNS_SQL} ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).all(MAX_RUNS) as unknown as RunRow[])
      : (db.prepare(`${RUNS_SQL} WHERE c.id = ?`).all(campaignId) as unknown as RunRow[]);
  return { rows: rows.map((r) => toRun(db, r)) };
}
