import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db/transaction.ts";
import type { Schedule } from "../domain/schedule.ts";
import type { CampaignEventsPage, UncertainPage } from "../http/contract.ts";
import { nextTurn } from "../send/async.ts";
import type { CampaignStatus } from "../send/sendState.ts";

export const SEND_ROW_BATCH = 1000;

export interface CampaignRecord {
  id: number;
  list_id: number;
  template_id: number;
  template_version: number;
  status: CampaignStatus;
  schedule_json: string;
}

export function getCampaign(db: DatabaseSync, id: number): CampaignRecord | null {
  const row = db
    .prepare("SELECT id, list_id, template_id, template_version, status, schedule_json FROM campaigns WHERE id = ?")
    .get(id) as CampaignRecord | undefined;
  return row ? { ...row } : null;
}

export function listCampaignIds(db: DatabaseSync): number[] {
  return (db.prepare("SELECT id FROM campaigns ORDER BY id DESC").all() as { id: number }[]).map((r) => r.id);
}

/**
 * Inserts the campaign and one pending sends row per contact, in committed batches that yield between them.
 * The id is in `inProgress` from the first commit until the last batch, so callers can refuse to act on it meanwhile.
 */
export async function createCampaign(
  db: DatabaseSync,
  input: { listId: number; templateId: number; templateVersion: number; schedule: Schedule },
  inProgress: Set<number> = new Set(),
): Promise<number> {
  const insertBatch = db.prepare(
    `INSERT INTO sends (campaign_id, contact_id)
     SELECT ?, id FROM contacts WHERE list_id = ? AND id > ? ORDER BY id LIMIT ${SEND_ROW_BATCH}`,
  );
  const lastContact = db.prepare("SELECT MAX(contact_id) AS id FROM sends WHERE campaign_id = ?");
  let id = 0;
  try {
    let after = 0;
    for (;;) {
      const inserted = transaction(db, () => {
        if (id === 0) {
          id = Number(
            db
              .prepare("INSERT INTO campaigns (list_id, template_id, template_version, schedule_json) VALUES (?, ?, ?, ?)")
              .run(input.listId, input.templateId, input.templateVersion, JSON.stringify(input.schedule)).lastInsertRowid,
          );
        }
        return Number(insertBatch.run(id, input.listId, after).changes);
      });
      inProgress.add(id);
      if (inserted < SEND_ROW_BATCH) return id;
      after = (lastContact.get(id) as { id: number }).id;
      await nextTurn();
    }
  } catch (err) {
    if (id !== 0) deleteCampaign(db, id);
    throw err;
  } finally {
    inProgress.delete(id);
  }
}

export function listContactCount(db: DatabaseSync, listId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE list_id = ?").get(listId) as { n: number }).n;
}

export function updateSchedule(db: DatabaseSync, id: number, schedule: Schedule): void {
  db.prepare("UPDATE campaigns SET schedule_json = ? WHERE id = ?").run(JSON.stringify(schedule), id);
}

export function deleteCampaign(db: DatabaseSync, id: number): void {
  transaction(db, () => {
    db.prepare("DELETE FROM events WHERE campaign_id = ?").run(id);
    db.prepare("DELETE FROM campaigns WHERE id = ?").run(id);
  });
}

export function recordEvent(db: DatabaseSync, campaignId: number, type: string, message: string, at: Date = new Date()): void {
  db.prepare("INSERT INTO events (campaign_id, type, message, created_at) VALUES (?, ?, ?, ?)").run(campaignId, type, message, at.toISOString());
}

export function uncertainPage(db: DatabaseSync, id: number, limit: number, offset: number): UncertainPage {
  const rows = db
    .prepare(
      `SELECT s.contact_id AS contactId, c.email, s.last_error AS lastError, s.updated_at AS updatedAt
       FROM sends s JOIN contacts c ON c.id = s.contact_id
       WHERE s.campaign_id = ? AND s.state = 'uncertain' ORDER BY s.contact_id LIMIT ? OFFSET ?`,
    )
    .all(id, limit, offset) as UncertainPage["rows"];
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM sends WHERE campaign_id = ? AND state = 'uncertain'").get(id) as { n: number };
  return { rows: rows.map((r) => ({ ...r })), total: n };
}

export function eventsPage(
  db: DatabaseSync,
  id: number,
  q: { type?: string; limit: number; beforeId?: number },
): CampaignEventsPage {
  const rows = db
    .prepare(
      `SELECT id, type, message, created_at AS createdAt FROM events
       WHERE campaign_id = ? AND (? IS NULL OR type = ?) AND id < ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(id, q.type ?? null, q.type ?? null, q.beforeId ?? Number.MAX_SAFE_INTEGER, q.limit) as CampaignEventsPage["rows"];
  return { rows: rows.map((r) => ({ ...r })) };
}
