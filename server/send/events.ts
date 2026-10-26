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

/** Newest events kept in the SQLite ring; older rows are deleted after trim. */
export const KEEP_EVENTS = 50_000;
export const TRIM_EVERY = 1_000;

/** Best-effort WAL recycle; ignores busy / non-WAL databases. */
export function walCheckpoint(db: DatabaseSync): void {
  try {
    db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  } catch {
    // Another writer holds the WAL, or this connection is not in WAL mode.
  }
}

/** Best-effort query planner refresh; safe to call after daily backup. */
export function optimizeDb(db: DatabaseSync): void {
  try {
    db.prepare("PRAGMA optimize").run();
  } catch {
    // Optional maintenance; never fail the caller.
  }
}

export class EventLog {
  private sinceTrim = 0;
  private readonly keep: number;
  private readonly trimEvery: number;

  constructor(
    private readonly db: DatabaseSync,
    opts: { keep?: number; trimEvery?: number } = {},
  ) {
    this.keep = opts.keep ?? KEEP_EVENTS;
    this.trimEvery = opts.trimEvery ?? TRIM_EVERY;
  }

  insert(e: WorkerEvent): number {
    const r = this.db
      .prepare("INSERT INTO events (campaign_id, type, message, created_at) VALUES (?, ?, ?, ?)")
      .run(e.campaignId, e.type, e.message, e.at);
    this.sinceTrim += 1;
    return Number(r.lastInsertRowid);
  }

  trimIfDue(): void {
    if (this.sinceTrim < this.trimEvery) return;
    this.sinceTrim = 0;
    this.db.prepare("DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?").run(this.keep);
    walCheckpoint(this.db);
  }

  /** Force a ring trim (and WAL checkpoint) regardless of insert count — tests / maintenance. */
  trimNow(): void {
    this.sinceTrim = this.trimEvery;
    this.trimIfDue();
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
