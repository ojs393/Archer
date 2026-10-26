import type { DatabaseSync } from "node:sqlite";
import type { AnalyticsSummary } from "../http/contract.ts";
import { allTotals, campaignTotals, outcomeRates } from "./outcomes.ts";

function maxAt(row: unknown): string | null {
  return (row as { at: string | null }).at;
}

/** Sent events can be trimmed from the ring; the sends rows keep the time of their last state change. */
function lastSendAt(db: DatabaseSync, campaignId: number | null): string | null {
  if (campaignId === null) {
    return (
      maxAt(db.prepare("SELECT MAX(created_at) AS at FROM events WHERE type = 'sent'").get()) ??
      maxAt(
        db
          .prepare("SELECT MAX((SELECT MAX(updated_at) FROM sends WHERE campaign_id = c.id AND state = 'sent')) AS at FROM campaigns c")
          .get(),
      )
    );
  }
  return (
    maxAt(db.prepare("SELECT MAX(created_at) AS at FROM events WHERE type = 'sent' AND campaign_id = ?").get(campaignId)) ??
    maxAt(db.prepare("SELECT MAX(updated_at) AS at FROM sends WHERE campaign_id = ? AND state = 'sent'").get(campaignId))
  );
}

export function analyticsSummary(db: DatabaseSync, campaignId: number | null): AnalyticsSummary {
  const totals = campaignId === null ? allTotals(db) : campaignTotals(db, campaignId);
  return { totals, rates: outcomeRates(totals), lastSendAt: lastSendAt(db, campaignId) };
}
