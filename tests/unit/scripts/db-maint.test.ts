import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkIntegrity, restoreLatestBackup } from "../../../scripts/lib/db-maint.mjs";
import { projectRoot } from "../../../scripts/lib/paths.mjs";

let dir: string;
let dbPath: string;
let backupsDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-db-"));
  dbPath = path.join(dir, "archer.db");
  backupsDir = path.join(dir, "backups");
  fs.mkdirSync(backupsDir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeDb(file: string, marker: string, mtime?: Date) {
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE t (v TEXT)");
  db.prepare("INSERT INTO t (v) VALUES (?)").run(marker);
  db.close();
  if (mtime) fs.utimesSync(file, mtime, mtime);
}

function readMarker(file: string): unknown {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare("SELECT v FROM t").get() as { v: string }).v;
  } finally {
    db.close();
  }
}

describe("checkIntegrity", () => {
  it("treats a missing database as ok", () => {
    expect(checkIntegrity(dbPath)).toEqual({ ok: true, status: "missing" });
  });

  it("passes a valid database", () => {
    makeDb(dbPath, "x");
    expect(checkIntegrity(dbPath)).toEqual({ ok: true, status: "ok" });
  });

  it("fails a garbage file", () => {
    fs.writeFileSync(dbPath, "this is not a sqlite database".repeat(100));
    const r = checkIntegrity(dbPath);
    expect(r.ok).toBe(false);
    expect(r.status).toBe("corrupt");
    expect(r.detail).toBeTruthy();
  });

  it("reports an unopenable path as an error, not as corruption", () => {
    fs.mkdirSync(dbPath);
    const r = checkIntegrity(dbPath);
    expect(r.ok).toBe(false);
    expect(r.status).toBe("error");
  });

  it("does not create a file when the database is missing", () => {
    checkIntegrity(dbPath);
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("does not print the node:sqlite ExperimentalWarning when run without node flags", () => {
    makeDb(dbPath, "x");
    const moduleUrl = pathToFileURL(path.join(projectRoot(), "scripts", "lib", "db-maint.mjs")).href;
    const script = `const m = await import(${JSON.stringify(moduleUrl)});
      console.log(JSON.stringify(m.checkIntegrity(${JSON.stringify(dbPath)})));`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    expect(child.stderr).toBe("");
    expect(JSON.parse(child.stdout)).toEqual({ ok: true, status: "ok" });
  });
});

describe("restoreLatestBackup", () => {
  it("reports nothing restored when there are no backups", () => {
    fs.writeFileSync(dbPath, "garbage");
    expect(restoreLatestBackup(dbPath, backupsDir)).toEqual({ restored: false });
  });

  it("reports nothing restored when the backups dir is missing", () => {
    expect(restoreLatestBackup(dbPath, path.join(dir, "nope"))).toEqual({ restored: false });
  });

  it("restores the newest valid backup and keeps the corrupt file aside", () => {
    fs.writeFileSync(dbPath, "garbage");
    makeDb(path.join(backupsDir, "old.db"), "old", new Date(2026, 0, 1));
    makeDb(path.join(backupsDir, "new.db"), "new", new Date(2026, 0, 2));

    const r = restoreLatestBackup(dbPath, backupsDir);

    expect(r).toEqual({ restored: true, from: path.join(backupsDir, "new.db") });
    expect(readMarker(dbPath)).toBe("new");
    const aside = fs.readdirSync(dir).filter((f) => f.startsWith("archer.db.corrupt-"));
    expect(aside).toHaveLength(1);
  });

  it("skips a corrupt backup in favor of an older valid one", () => {
    fs.writeFileSync(dbPath, "garbage");
    makeDb(path.join(backupsDir, "old.db"), "old", new Date(2026, 0, 1));
    fs.writeFileSync(path.join(backupsDir, "new.db"), "garbage".repeat(100));
    const newer = new Date(2026, 0, 2);
    fs.utimesSync(path.join(backupsDir, "new.db"), newer, newer);

    expect(restoreLatestBackup(dbPath, backupsDir)).toEqual({
      restored: true,
      from: path.join(backupsDir, "old.db"),
    });
    expect(readMarker(dbPath)).toBe("old");
  });

  it("removes stale WAL and SHM sidecars of the corrupt database", () => {
    fs.writeFileSync(dbPath, "garbage");
    fs.writeFileSync(`${dbPath}-wal`, "stale");
    fs.writeFileSync(`${dbPath}-shm`, "stale");
    makeDb(path.join(backupsDir, "b.db"), "b");

    restoreLatestBackup(dbPath, backupsDir);

    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false);
    expect(readMarker(dbPath)).toBe("b");
  });
});
