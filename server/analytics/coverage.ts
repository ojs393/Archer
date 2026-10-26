import type { DatabaseSync } from "node:sqlite";

/** created_at of the oldest event still kept (the events table is a ring of the newest 50,000), or null when none in scope. */
export function eventCoverageFrom(db: DatabaseSync, campaignId: number | null): string | null {
  const row =
    campaignId === null
      ? db.prepare("SELECT MIN(created_at) AS at FROM events").get()
      : db.prepare("SELECT MIN(created_at) AS at FROM events WHERE campaign_id = ?").get(campaignId);
  return (row as { at: string | null }).at;
}
