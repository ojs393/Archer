export interface IntegrityResult {
  ok: boolean;
  /** "error" means the file could not be checked (locked, unreadable) — not proof of corruption. */
  status: "missing" | "ok" | "corrupt" | "error";
  detail?: string;
}

export interface RestoreResult {
  restored: boolean;
  from?: string;
}

/** Loads node:sqlite while muting only its ExperimentalWarning. */
export function loadSqlite(): typeof import("node:sqlite");

export function checkIntegrity(dbPath: string): IntegrityResult;

/** Renames `dbPath` and its -wal/-shm sidecars to `<dbPath>.corrupt-<timestamp>`; returns the new path. */
export function moveAside(dbPath: string): string;

/** Replaces `dbPath` with the newest backup that passes an integrity check, keeping the old file aside. */
export function restoreLatestBackup(dbPath: string, backupsDir: string): RestoreResult;
