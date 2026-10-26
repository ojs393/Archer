import type { DatabaseSync } from "node:sqlite";

function isThenable(value: unknown): boolean {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    if (isThenable(result)) throw new TypeError("transaction() callback must be synchronous");
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // SQLite already rolled back (e.g. SQLITE_FULL); the original error is what matters.
    }
    throw err;
  }
}
