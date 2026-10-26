import type { DatabaseSync } from "node:sqlite";
import type { AnalyticsSummary } from "../http/contract.ts";
import { allTotals, campaignTotals, outcomeRates } from "./outcomes.ts";

function lastSendAt(db: DatabaseSync, campaignId: number | null): string | null {
  const row =
    campaignId === null
      ? db.prepare("SELECT MAX(created_at) AS at FROM events WHERE type = 'sent'").get()
      : db.prepare("SELECT MAX(created_at) AS at FROM events WHERE type = 'sent' AND campaign_id = ?").get(campaignId);
  return (row as { at: string | null }).at;
}

export function analyticsSummary(db: DatabaseSync, campaignId: number | null): AnalyticsSummary {
  const totals = campaignId === null ? allTotals(db) : campaignTotals(db, campaignId);
  return { totals, rates: outcomeRates(totals), lastSendAt: lastSendAt(db, campaignId) };
}
