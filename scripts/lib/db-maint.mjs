import fs from "node:fs";
import path from "node:path";

const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;
const SIDECARS = ["-wal", "-shm"];

export function loadSqlite() {
  // doctor/setup can't pass --disable-warning (older Nodes reject the flag before the version
  // check runs), so mute only node:sqlite's ExperimentalWarning, only while the module loads.
  const emitWarning = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
    const message = typeof warning === "string" ? warning : warning?.message;
    if (type === "ExperimentalWarning" && /sqlite/i.test(message ?? "")) return;
    return emitWarning.call(this, warning, ...rest);
  };
  try {
    return process.getBuiltinModule("node:sqlite");
  } finally {
    process.emitWarning = emitWarning;
  }
}

function openDatabase(dbPath) {
  const { DatabaseSync } = loadSqlite();
  return new DatabaseSync(dbPath);
}

export function checkIntegrity(dbPath) {
  if (!fs.existsSync(dbPath)) return { ok: true, status: "missing" };
  let db;
  try {
    db = openDatabase(dbPath);
    const messages = db.prepare("PRAGMA integrity_check").all().map((row) => String(Object.values(row)[0]));
    if (messages.length === 1 && messages[0] === "ok") return { ok: true, status: "ok" };
    return { ok: false, status: "corrupt", detail: messages.slice(0, 5).join("; ") };
  } catch (err) {
    const primary = typeof err.errcode === "number" ? err.errcode & 0xff : undefined;
    const corrupt = primary === SQLITE_CORRUPT || primary === SQLITE_NOTADB;
    return { ok: false, status: corrupt ? "corrupt" : "error", detail: err.message };
  } finally {
    db?.close();
  }
}

function newestFirst(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".db"))
    .map((name) => path.join(dir, name))
    .map((file) => ({ file, stat: fs.statSync(file) }))
    .filter(({ stat }) => stat.isFile())
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .map(({ file }) => file);
}

export function moveAside(dbPath) {
  const aside = `${dbPath}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  if (fs.existsSync(dbPath)) fs.renameSync(dbPath, aside);
  // A stale WAL would be replayed into whatever file takes dbPath's place and corrupt it again.
  for (const suffix of SIDECARS) {
    if (fs.existsSync(dbPath + suffix)) fs.renameSync(dbPath + suffix, aside + suffix);
  }
  return aside;
}

export function restoreLatestBackup(dbPath, backupsDir) {
  if (!fs.existsSync(backupsDir)) return { restored: false };
  const from = newestFirst(backupsDir).find((file) => checkIntegrity(file).status === "ok");
  if (!from) return { restored: false };

  moveAside(dbPath);

  const staging = `${dbPath}.restoring`;
  fs.copyFileSync(from, staging);
  fs.renameSync(staging, dbPath);
  return { restored: true, from };
}
