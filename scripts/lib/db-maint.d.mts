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

export function checkIntegrity(dbPath: string): IntegrityResult;

/** Replaces `dbPath` with the newest backup that passes an integrity check, keeping the old file aside. */
export function restoreLatestBackup(dbPath: string, backupsDir: string): RestoreResult;
