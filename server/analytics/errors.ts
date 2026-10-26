import type { DatabaseSync } from "node:sqlite";
import type { AnalyticsErrorKind, AnalyticsErrors } from "../http/contract.ts";
import { redact } from "../logger.ts";

export const MAX_MESSAGE = 160;

const KINDS: readonly AnalyticsErrorKind[] = ["failed", "suppressed", "retry", "uncertain"];
const EMAIL = /<[^<>\s@]+@[^<>\s@]+>|[^\s<>@"'(),;:[\]]+@[^\s<>@"'(),;:[\]]+/g;
const ISO_TIME = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const RETRY_COUNTER = /^Retry \d+\/\d+ /;

/** Timestamps and the worker's "Retry n/m" counter are dropped too, so repeats of one problem group together. */
export function normalizeErrorMessage(message: string): string {
  return redact(message)
    .replace(/\s+/g, " ")
    .trim()
    .replace(EMAIL, "<email>")
    .replace(ISO_TIME, "<time>")
    .replace(RETRY_COUNTER, "Retry ")
    .slice(0, MAX_MESSAGE);
}

export function analyticsErrors(db: DatabaseSync, q: { campaignId: number | null; limit: number }): AnalyticsErrors {
  const kinds = KINDS.map(() => "?").join(",");
  const scope = q.campaignId === null ? "" : " AND campaign_id = ?";
  const params: (string | number)[] = [...KINDS];
  if (q.campaignId !== null) params.push(q.campaignId);
  const raw = db
    .prepare(
      `SELECT type, message, COUNT(*) AS n, MAX(created_at) AS lastAt FROM events
       WHERE type IN (${kinds})${scope}
       GROUP BY type, message`,
    )
    .all(...params) as { type: AnalyticsErrorKind; message: string; n: number; lastAt: string }[];

  const groups = new Map<string, AnalyticsErrors["rows"][number]>();
  for (const r of raw) {
    const message = normalizeErrorMessage(r.message);
    const key = `${r.type}\u0000${message}`;
    const group = groups.get(key);
    if (!group) groups.set(key, { kind: r.type, message, count: r.n, lastAt: r.lastAt });
    else {
      group.count += r.n;
      if (r.lastAt > group.lastAt) group.lastAt = r.lastAt;
    }
  }
  const rows = [...groups.values()].sort((a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  return { rows: rows.slice(0, q.limit) };
}
