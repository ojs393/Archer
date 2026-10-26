import type { DatabaseSync } from "node:sqlite";
import type { AnalyticsSummary, AnalyticsTotals } from "../http/contract.ts";

type State = "pending" | "sending" | "sent" | "retry" | "failed" | "uncertain" | "skipped_suppressed";

/**
 * A hard bounce leaves its sends row `failed` and adds a `hard_bounce` suppression for the address, so bounces
 * are the failed rows whose address carries that suppression. Events cannot be used: they are trimmed to the newest 50,000.
 * CROSS JOIN pins the join order to start from the run's failed rows; after ANALYZE the planner otherwise scans the
 * whole suppression table instead.
 */
const BOUNCES_SQL = `
  SELECT COUNT(*) AS n FROM sends s
  CROSS JOIN contacts c ON c.id = s.contact_id
  CROSS JOIN suppression x ON x.email = c.email AND x.reason = 'hard_bounce'
  WHERE s.campaign_id = ? AND s.state = 'failed'`;

function emptyTotals(): AnalyticsTotals {
  return { recipients: 0, sent: 0, failed: 0, suppressed: 0, retry: 0, uncertain: 0, skipped: 0, pending: 0 };
}

export function campaignTotals(db: DatabaseSync, campaignId: number): AnalyticsTotals {
  const totals = emptyTotals();
  const rows = db.prepare("SELECT state, COUNT(*) AS n FROM sends WHERE campaign_id = ? GROUP BY state").all(campaignId) as {
    state: State;
    n: number;
  }[];
  let failed = 0;
  for (const { state, n } of rows) {
    totals.recipients += n;
    if (state === "pending" || state === "sending") totals.pending += n;
    else if (state === "skipped_suppressed") totals.skipped += n;
    else if (state === "failed") failed = n;
    else totals[state] += n;
  }
  if (failed > 0) {
    const { n } = db.prepare(BOUNCES_SQL).get(campaignId) as { n: number };
    totals.suppressed = n;
    totals.failed = failed - n;
  }
  return totals;
}

export function allTotals(db: DatabaseSync): AnalyticsTotals {
  const totals = emptyTotals();
  const ids = db.prepare("SELECT id FROM campaigns").all() as { id: number }[];
  for (const { id } of ids) {
    const t = campaignTotals(db, id);
    for (const key of Object.keys(totals) as (keyof AnalyticsTotals)[]) totals[key] += t[key];
  }
  return totals;
}

export function attempts(t: Pick<AnalyticsTotals, "sent" | "failed" | "suppressed">): number {
  return t.sent + t.failed + t.suppressed;
}

export function deliveryRate(t: Pick<AnalyticsTotals, "sent" | "failed" | "suppressed">): number {
  const n = attempts(t);
  return n ? t.sent / n : 0;
}

export function outcomeRates(t: AnalyticsTotals): AnalyticsSummary["rates"] {
  const n = attempts(t);
  return {
    deliveryRate: deliveryRate(t),
    bounceRate: n ? t.suppressed / n : 0,
    rejectionRate: n ? (t.failed + t.suppressed) / n : 0,
  };
}
