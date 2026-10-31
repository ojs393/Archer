import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  checkIntegrity as checkFileIntegrity,
  loadSqlite,
  moveAside,
  restoreLatestBackup,
} from "../../scripts/lib/db-maint.mjs";
import { optimizeDb, walCheckpoint } from "../send/events.ts";
import { freeBytes, MIN_FREE_GIB_FOR_BACKUP } from "../system/diskSpace.ts";
import { runMigrations } from "./migrate.ts";

export { runMigrations } from "./migrate.ts";
export { transaction } from "./transaction.ts";

export const BACKUPS_KEPT = 7;
const BACKUP_NAME = /^archer-\d{4}-\d{2}-\d{2}\.db$/;

export interface RecoveredDb {
  db: DatabaseSync;
  restoredFrom: string | null;
  quarantined: string | null;
}

export function openDb(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
    `);
    runMigrations(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

export function checkIntegrity(db: DatabaseSync): boolean {
  const rows = db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
  return rows.length === 1 && rows[0]?.integrity_check === "ok";
}

/** Keep only the newest BACKUPS_KEPT daily `archer-YYYY-MM-DD.db` files. */
export function pruneBackups(backupsDir: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(backupsDir);
  } catch {
    return;
  }
  const newestFirst = names.filter((name) => BACKUP_NAME.test(name)).sort().reverse();
  for (const name of newestFirst.slice(BACKUPS_KEPT)) fs.rmSync(path.join(backupsDir, name), { force: true });
}

export function backup(db: DatabaseSync, backupsDir: string, now: Date = new Date()): string {
  fs.mkdirSync(backupsDir, { recursive: true });
  const target = path.join(backupsDir, `archer-${now.toISOString().slice(0, 10)}.db`);
  if (!fs.existsSync(target)) {
    // VACUUM INTO needs roughly the live DB size free; require a floor so we fail soft.
    const dbPath = (db.prepare("PRAGMA database_list").all() as { file: string }[]).find((r) => r.file)?.file;
    if (dbPath) {
      const need = Math.max(fs.statSync(dbPath).size * 1.1, MIN_FREE_GIB_FOR_BACKUP * 1024 ** 3);
      let avail = 0;
      try {
        avail = freeBytes(path.dirname(dbPath));
      } catch {
        avail = need;
      }
      if (avail < need) {
        throw new Error(
          `Not enough free disk for backup (need ~${(need / 1024 ** 3).toFixed(1)} GiB, have ${(avail / 1024 ** 3).toFixed(1)} GiB)`,
        );
      }
    }
    const staging = `${target}.partial`;
    fs.rmSync(staging, { force: true });
    db.prepare("VACUUM INTO ?").run(staging);
    fs.renameSync(staging, target);
  }
  pruneBackups(backupsDir);
  walCheckpoint(db);
  optimizeDb(db);
  return target;
}

export function openDbWithRecovery(dbPath: string, backupsDir: string): RecoveredDb {
  let restoredFrom: string | null = null;
  let quarantined: string | null = null;
  if (checkFileIntegrity(dbPath).status === "corrupt") {
    const restore = restoreLatestBackup(dbPath, backupsDir);
    if (restore.restored && restore.from) restoredFrom = restore.from;
    else quarantined = moveAside(dbPath);
  }
  return { db: openDb(dbPath), restoredFrom, quarantined };
}
