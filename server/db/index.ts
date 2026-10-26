import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  checkIntegrity as checkFileIntegrity,
  loadSqlite,
  moveAside,
  restoreLatestBackup,
} from "../../scripts/lib/db-maint.mjs";
import { runMigrations } from "./migrate.ts";

export { runMigrations } from "./migrate.ts";
export { transaction } from "./transaction.ts";

const BACKUPS_KEPT = 7;
const BACKUP_NAME = /^mamadirect-\d{4}-\d{2}-\d{2}\.db$/;

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
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
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

function pruneBackups(backupsDir: string): void {
  const newestFirst = fs
    .readdirSync(backupsDir)
    .filter((name) => BACKUP_NAME.test(name))
    .sort()
    .reverse();
  for (const name of newestFirst.slice(BACKUPS_KEPT)) fs.rmSync(path.join(backupsDir, name));
}

export function backup(db: DatabaseSync, backupsDir: string, now: Date = new Date()): string {
  fs.mkdirSync(backupsDir, { recursive: true });
  const target = path.join(backupsDir, `mamadirect-${now.toISOString().slice(0, 10)}.db`);
  if (!fs.existsSync(target)) {
    const staging = `${target}.partial`;
    fs.rmSync(staging, { force: true });
    db.prepare("VACUUM INTO ?").run(staging);
    fs.renameSync(staging, target);
  }
  pruneBackups(backupsDir);
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
