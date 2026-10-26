import type { DatabaseSync, StatementSync } from "node:sqlite";
import { normalizeEmail } from "../domain/email.ts";

export type SuppressionReason = "unsubscribe" | "hard_bounce" | "manual" | "complaint";

export interface SuppressionRow {
  email: string;
  reason: SuppressionReason;
  created_at: string;
}

const MAX_PAGE = 1000;

const lookups = new WeakMap<DatabaseSync, StatementSync>();

function lookup(db: DatabaseSync): StatementSync {
  let stmt = lookups.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT 1 FROM suppression WHERE email = ?");
    lookups.set(db, stmt);
  }
  return stmt;
}

export function isSuppressed(db: DatabaseSync, email: string): boolean {
  return lookup(db).get(normalizeEmail(email)) !== undefined;
}

export function addSuppression(db: DatabaseSync, email: string, reason: SuppressionReason): boolean {
  const r = db.prepare("INSERT OR IGNORE INTO suppression (email, reason) VALUES (?, ?)").run(normalizeEmail(email), reason);
  return Number(r.changes) > 0;
}

export function removeSuppression(db: DatabaseSync, email: string): boolean {
  return Number(db.prepare("DELETE FROM suppression WHERE email = ?").run(normalizeEmail(email)).changes) > 0;
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.trunc(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

export function listSuppression(
  db: DatabaseSync,
  opts: { search?: string; limit: number; offset: number },
): { rows: SuppressionRow[]; total: number } {
  const search = opts.search?.trim().toLowerCase() ?? "";
  const where = search ? "WHERE instr(email, ?) > 0" : "";
  const params = search ? [search] : [];
  const limit = clampInt(opts.limit, 0, MAX_PAGE);
  const offset = clampInt(opts.offset, 0, Number.MAX_SAFE_INTEGER);
  const rows = db
    .prepare(`SELECT email, reason, created_at FROM suppression ${where} ORDER BY created_at DESC, email LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as SuppressionRow[];
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM suppression ${where}`).get(...params) as { n: number };
  return { rows: rows.map((r) => ({ ...r })), total: n };
}
