import type { DatabaseSync } from "node:sqlite";

export type WorkerEventType = "status" | "sent" | "retry" | "failed" | "suppressed" | "skipped" | "uncertain" | "error";

export interface WorkerEvent {
  type: WorkerEventType;
  campaignId: number;
  contactId?: number;
  email?: string;
  message: string;
  at: string;
}

export interface SafetyConfig {
  window: number;
  minSample: number;
  threshold: number;
}

const KEEP_EVENTS = 50_000;
const TRIM_EVERY = 1_000;

export class EventLog {
  private sinceTrim = 0;

  constructor(private readonly db: DatabaseSync) {}

  insert(e: WorkerEvent): number {
    const r = this.db
      .prepare("INSERT INTO events (campaign_id, type, message, created_at) VALUES (?, ?, ?, ?)")
      .run(e.campaignId, e.type, e.message, e.at);
    this.sinceTrim += 1;
    return Number(r.lastInsertRowid);
  }

  trimIfDue(): void {
    if (this.sinceTrim < TRIM_EVERY) return;
    this.sinceTrim = 0;
    this.db.prepare("DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?").run(KEEP_EVENTS);
  }

  lastIdOf(campaignId: number, type: WorkerEventType, message: string): number {
    const row = this.db
      .prepare("SELECT MAX(id) AS id FROM events WHERE campaign_id = ? AND type = ? AND message = ?")
      .get(campaignId, type, message) as { id: number | null };
    return row.id ?? 0;
  }

  rejectionRateExceeded(campaignId: number, afterId: number, cfg: SafetyConfig): boolean {
    const rows = this.db
      .prepare(
        `SELECT type FROM events WHERE campaign_id = ? AND id > ? AND type IN ('sent','failed','suppressed')
         ORDER BY id DESC LIMIT ?`,
      )
      .all(campaignId, afterId, cfg.window) as { type: string }[];
    if (rows.length < cfg.minSample) return false;
    const rejections = rows.filter((r) => r.type !== "sent").length;
    return rejections / rows.length > cfg.threshold;
  }
}
