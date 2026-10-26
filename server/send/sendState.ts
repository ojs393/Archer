import type { DatabaseSync } from "node:sqlite";

export type CampaignStatus =
  | "draft"
  | "running"
  | "paused"
  | "waiting_window"
  | "waiting_network"
  | "safety_stop"
  | "completed"
  | "stopped";

export const ACTIVE_STATUSES: ReadonlySet<CampaignStatus> = new Set(["running", "waiting_window", "waiting_network"]);
const HELD_STATUSES = ["running", "waiting_window", "waiting_network", "paused", "safety_stop"];

export interface CampaignRow {
  id: number;
  template_id: number;
  template_version: number;
  status: CampaignStatus;
  pause_reason: string | null;
  schedule_json: string;
  started_at: string | null;
}

export interface TemplateRow {
  version: number;
  subject: string;
  html: string;
  text: string | null;
  variable_map_json: string;
}

export interface SendRow {
  campaign_id: number;
  contact_id: number;
  email: string;
  fields_json: string;
  attempts: number;
}

export class SendStore {
  constructor(private readonly db: DatabaseSync) {}

  campaign(id: number): CampaignRow | undefined {
    const row = this.db
      .prepare("SELECT id, template_id, template_version, status, pause_reason, schedule_json, started_at FROM campaigns WHERE id = ?")
      .get(id) as CampaignRow | undefined;
    return row ? { ...row } : undefined;
  }

  otherHeldCampaign(id: number): number | undefined {
    const row = this.db
      .prepare(`SELECT id FROM campaigns WHERE id != ? AND status IN (${HELD_STATUSES.map(() => "?").join(",")}) LIMIT 1`)
      .get(id, ...HELD_STATUSES) as { id: number } | undefined;
    return row?.id;
  }

  latestActiveCampaign(): number | null {
    const row = this.db
      .prepare(
        `SELECT id FROM campaigns WHERE status IN ('running','waiting_window','waiting_network')
         ORDER BY COALESCE(started_at, created_at) DESC, id DESC LIMIT 1`,
      )
      .get() as { id: number } | undefined;
    return row?.id ?? null;
  }

  setStatus(id: number, status: CampaignStatus, reason: string | null, at: string): void {
    this.db
      .prepare(
        `UPDATE campaigns SET status = ?, pause_reason = ?,
           started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
           finished_at = CASE WHEN ? IN ('completed','stopped') THEN ? WHEN ? = 'running' THEN NULL ELSE finished_at END
         WHERE id = ?`,
      )
      .run(status, reason, status, at, status, at, status, id);
  }

  template(id: number): TemplateRow | undefined {
    const row = this.db.prepare("SELECT version, subject, html, text, variable_map_json FROM templates WHERE id = ?").get(id) as
      | TemplateRow
      | undefined;
    return row ? { ...row } : undefined;
  }

  nextDue(campaignId: number, nowIso: string): SendRow | undefined {
    const pending = this.db
      .prepare("SELECT contact_id FROM sends WHERE campaign_id = ? AND state = 'pending' ORDER BY contact_id LIMIT 1")
      .get(campaignId) as { contact_id: number } | undefined;
    const retry = this.db
      .prepare(
        "SELECT contact_id FROM sends WHERE campaign_id = ? AND state = 'retry' AND next_attempt_at <= ? ORDER BY contact_id LIMIT 1",
      )
      .get(campaignId, nowIso) as { contact_id: number } | undefined;
    const ids = [pending?.contact_id, retry?.contact_id].filter((id): id is number => id !== undefined);
    if (ids.length === 0) return undefined;
    const row = this.db
      .prepare(
        `SELECT s.campaign_id, s.contact_id, c.email, c.fields_json, s.attempts
         FROM sends s JOIN contacts c ON c.id = s.contact_id WHERE s.campaign_id = ? AND s.contact_id = ?`,
      )
      .get(campaignId, Math.min(...ids)) as SendRow | undefined;
    return row ? { ...row } : undefined;
  }

  hasOpenRows(campaignId: number): boolean {
    return (
      this.db
        .prepare("SELECT 1 FROM sends WHERE campaign_id = ? AND state IN ('pending','retry','sending') LIMIT 1")
        .get(campaignId) !== undefined
    );
  }

  earliestRetry(campaignId: number): string | null {
    const row = this.db
      .prepare("SELECT MIN(next_attempt_at) AS at FROM sends WHERE campaign_id = ? AND state = 'retry'")
      .get(campaignId) as { at: string | null };
    return row.at;
  }

  sendingRows(campaignId?: number): SendRow[] {
    const where = campaignId === undefined ? "" : "AND s.campaign_id = ?";
    const rows = this.db
      .prepare(
        `SELECT s.campaign_id, s.contact_id, c.email, c.fields_json, s.attempts
         FROM sends s JOIN contacts c ON c.id = s.contact_id WHERE s.state = 'sending' ${where} ORDER BY s.contact_id`,
      )
      .all(...(campaignId === undefined ? [] : [campaignId])) as unknown as SendRow[];
    return rows.map((r) => ({ ...r }));
  }

  markSending(campaignId: number, contactId: number, at: string): boolean {
    const r = this.db
      .prepare(
        `UPDATE sends SET state = 'sending', attempts = attempts + 1, updated_at = ?
         WHERE campaign_id = ? AND contact_id = ? AND state IN ('pending','retry')`,
      )
      .run(at, campaignId, contactId);
    return Number(r.changes) === 1;
  }

  revertToPending(campaignId: number, contactId: number, at: string): void {
    this.db
      .prepare(
        `UPDATE sends SET state = 'pending', attempts = MAX(attempts - 1, 0), updated_at = ?
         WHERE campaign_id = ? AND contact_id = ? AND state = 'sending'`,
      )
      .run(at, campaignId, contactId);
  }

  markSent(campaignId: number, contactId: number, info: { messageId: string; response: string }, day: string, at: string): boolean {
    const r = this.db
      .prepare(
        `UPDATE sends SET state = 'sent', message_id = ?, smtp_response = ?, last_error = NULL, next_attempt_at = NULL, updated_at = ?
         WHERE campaign_id = ? AND contact_id = ? AND state = 'sending'`,
      )
      .run(info.messageId, info.response, at, campaignId, contactId);
    if (Number(r.changes) !== 1) return false;
    this.db
      .prepare(
        `INSERT INTO campaign_days (campaign_id, day, sent) VALUES (?, ?, 1)
         ON CONFLICT (campaign_id, day) DO UPDATE SET sent = sent + 1`,
      )
      .run(campaignId, day);
    return true;
  }

  markRetry(campaignId: number, contactId: number, nextAt: string, error: string, response: string | null, at: string): boolean {
    return this.finish(campaignId, contactId, "retry", { nextAt, error, response, at });
  }

  markFailed(campaignId: number, contactId: number, error: string, response: string | null, at: string): boolean {
    return this.finish(campaignId, contactId, "failed", { nextAt: null, error, response, at });
  }

  markUncertain(campaignId: number, contactId: number, error: string, at: string): boolean {
    return this.finish(campaignId, contactId, "uncertain", { nextAt: null, error, response: null, at });
  }

  markSkipped(campaignId: number, contactId: number, at: string): boolean {
    const r = this.db
      .prepare(
        `UPDATE sends SET state = 'skipped_suppressed', next_attempt_at = NULL, updated_at = ?
         WHERE campaign_id = ? AND contact_id = ? AND state IN ('pending','retry')`,
      )
      .run(at, campaignId, contactId);
    return Number(r.changes) === 1;
  }

  private finish(
    campaignId: number,
    contactId: number,
    state: "retry" | "failed" | "uncertain",
    f: { nextAt: string | null; error: string; response: string | null; at: string },
  ): boolean {
    const r = this.db
      .prepare(
        `UPDATE sends SET state = ?, next_attempt_at = ?, last_error = ?, smtp_response = COALESCE(?, smtp_response), updated_at = ?
         WHERE campaign_id = ? AND contact_id = ? AND state = 'sending'`,
      )
      .run(state, f.nextAt, f.error, f.response, f.at, campaignId, contactId);
    return Number(r.changes) === 1;
  }

  sentOn(campaignId: number, day: string): number {
    const row = this.db.prepare("SELECT sent FROM campaign_days WHERE campaign_id = ? AND day = ?").get(campaignId, day) as
      | { sent: number }
      | undefined;
    return row?.sent ?? 0;
  }

  sendDaysBefore(campaignId: number, day: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM campaign_days WHERE campaign_id = ? AND day < ? AND sent > 0")
      .get(campaignId, day) as { n: number };
    return row.n;
  }

  requeueUncertain(campaignId: number, contactIds: number[] | undefined, at: string): number {
    const filter = contactIds === undefined ? "" : `AND contact_id IN (SELECT value FROM json_each(?))`;
    const params = contactIds === undefined ? [] : [JSON.stringify(contactIds)];
    const r = this.db
      .prepare(
        `UPDATE sends SET state = 'pending', next_attempt_at = NULL, updated_at = ?
         WHERE campaign_id = ? AND state = 'uncertain' ${filter}`,
      )
      .run(at, campaignId, ...params);
    return Number(r.changes);
  }
}
