import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db/transaction.ts";
import type { CampaignSendsPage, SendRowState } from "../http/contract.ts";
import { SEND_ROW_BATCH } from "./store.ts";

const REBUILD_STATES = new Set(["pending", "retry"]);

export function sendsPage(
  db: DatabaseSync,
  campaignId: number,
  q: { state?: SendRowState; search?: string; limit: number; offset: number },
): CampaignSendsPage {
  const where: string[] = ["s.campaign_id = ?"];
  const params: (string | number)[] = [campaignId];
  if (q.state) {
    where.push("s.state = ?");
    params.push(q.state);
  }
  if (q.search) {
    where.push("c.email LIKE ? ESCAPE '\\'");
    params.push(`%${q.search.replace(/([%_\\])/g, "\\$1")}%`);
  }
  const clause = where.join(" AND ");
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM sends s JOIN contacts c ON c.id = s.contact_id WHERE ${clause}`).get(...params) as {
      n: number;
    }
  ).n;
  const rows = db
    .prepare(
      `SELECT s.contact_id AS contactId, c.email, s.state, s.attempts, s.last_error AS lastError,
              s.smtp_response AS smtpResponse, s.message_id AS messageId, s.updated_at AS updatedAt
       FROM sends s JOIN contacts c ON c.id = s.contact_id
       WHERE ${clause}
       ORDER BY s.contact_id
       LIMIT ? OFFSET ?`,
    )
    .all(...params, q.limit, q.offset) as unknown as CampaignSendsPage["rows"];
  return { total, rows: rows.map((r) => ({ ...r })) };
}

/** Drop pending/retry rows and enqueue missing contacts from the new list. Keeps terminal send history. */
export function swapCampaignList(db: DatabaseSync, campaignId: number, listId: number): { removed: number; added: number } {
  return transaction(db, () => {
    db.prepare("UPDATE campaigns SET list_id = ? WHERE id = ?").run(listId, campaignId);
    const removed = Number(
      db.prepare(`DELETE FROM sends WHERE campaign_id = ? AND state IN ('pending','retry')`).run(campaignId).changes,
    );
    let added = 0;
    let after = 0;
    const insertBatch = db.prepare(
      `INSERT OR IGNORE INTO sends (campaign_id, contact_id)
       SELECT ?, id FROM contacts WHERE list_id = ? AND id > ? ORDER BY id LIMIT ${SEND_ROW_BATCH}`,
    );
    const lastContact = db.prepare("SELECT MAX(contact_id) AS id FROM sends WHERE campaign_id = ?");
    for (;;) {
      const n = Number(insertBatch.run(campaignId, listId, after).changes);
      added += n;
      if (n < SEND_ROW_BATCH) break;
      after = (lastContact.get(campaignId) as { id: number | null }).id ?? after;
    }
    return { removed, added };
  });
}

export function swapCampaignTemplate(db: DatabaseSync, campaignId: number, templateId: number, templateVersion: number): void {
  db.prepare("UPDATE campaigns SET template_id = ?, template_version = ? WHERE id = ?").run(templateId, templateVersion, campaignId);
}

export function isRebuildState(state: string): boolean {
  return REBUILD_STATES.has(state);
}
