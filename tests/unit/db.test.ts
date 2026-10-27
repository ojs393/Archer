import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backup,
  checkIntegrity,
  openDb,
  openDbWithRecovery,
  transaction,
} from "../../server/db/index.ts";
import { runMigrations } from "../../server/db/migrate.ts";
import { getAllSettings, getSetting, setSetting } from "../../server/db/settings.ts";

const TABLES = ["campaign_days", "campaigns", "contacts", "events", "lists", "sends", "settings", "suppression", "templates"];

let dir: string;
const open: DatabaseSync[] = [];

function track(db: DatabaseSync): DatabaseSync {
  open.push(db);
  return db;
}

function memDb(): DatabaseSync {
  return track(openDb(":memory:"));
}

function insertList(db: DatabaseSync): number {
  const r = db
    .prepare("INSERT INTO lists (name, source_label, consent_text, consent_at) VALUES ('L', 'src', 'ok', '2026-10-25T00:00:00.000Z')")
    .run();
  return Number(r.lastInsertRowid);
}

function insertCampaignWithContact(db: DatabaseSync): { campaignId: number; contactId: number } {
  const listId = insertList(db);
  const contactId = Number(
    db.prepare("INSERT INTO contacts (list_id, email, domain) VALUES (?, 'a@x.com', 'x.com')").run(listId).lastInsertRowid,
  );
  const templateId = Number(
    db.prepare("INSERT INTO templates (name, subject, html) VALUES ('T', 'S', '<p>h</p>')").run().lastInsertRowid,
  );
  const campaignId = Number(
    db
      .prepare("INSERT INTO campaigns (list_id, template_id, template_version, schedule_json) VALUES (?, ?, 1, '{}')")
      .run(listId, templateId).lastInsertRowid,
  );
  return { campaignId, contactId };
}

function indexColumns(db: DatabaseSync, table: string): string[][] {
  const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[];
  return indexes.map((ix) =>
    (db.prepare(`PRAGMA index_info(${JSON.stringify(ix.name)})`).all() as { seqno: number; name: string }[])
      .sort((a, b) => a.seqno - b.seqno)
      .map((c) => c.name),
  );
}

function writeMarkerDb(file: string, marker: string) {
  const db = openDb(file);
  setSetting(db, "marker", marker);
  db.close();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-dblayer-"));
});

afterEach(() => {
  for (const db of open.splice(0)) {
    try {
      db.close();
    } catch {
      // already closed by the test
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("schema", () => {
  it("creates all eight tables", () => {
    const db = memDb();
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (r) => r.name,
    );
    for (const table of TABLES) expect(names).toContain(table);
  });

  it("gives sends a composite primary key of (campaign_id, contact_id)", () => {
    const db = memDb();
    const cols = db.prepare("PRAGMA table_info(sends)").all() as { name: string; pk: number }[];
    const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    expect(pk).toEqual(["campaign_id", "contact_id"]);
  });

  it("rejects a duplicate (list_id, email) in contacts", () => {
    const db = memDb();
    const listId = insertList(db);
    const insert = db.prepare("INSERT INTO contacts (list_id, email, domain) VALUES (?, 'a@x.com', 'x.com')");
    insert.run(listId);
    expect(() => insert.run(listId)).toThrow(/UNIQUE/);
  });

  it("has the indexes the send loop and importer rely on", () => {
    const db = memDb();
    expect(indexColumns(db, "contacts")).toContainEqual(["list_id", "domain"]);
    expect(indexColumns(db, "sends")).toContainEqual(["campaign_id", "state", "next_attempt_at"]);
    expect(indexColumns(db, "events")).toContainEqual(["campaign_id", "id"]);
  });

  it("indexes events by type and time for the analytics charts", () => {
    const db = memDb();
    expect(indexColumns(db, "events")).toContainEqual(["type", "created_at"]);
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT substr(created_at, 1, 13) AS k, type, COUNT(*) FROM events
         WHERE type IN ('sent','failed') AND created_at >= ? GROUP BY k, type`,
      )
      .all("2026-10-24T00:00:00.000Z") as { detail: string }[];
    expect(plan.map((r) => r.detail).join("\n")).toMatch(/SEARCH events USING (COVERING )?INDEX events_type_created/);
  });

  it("enforces foreign keys", () => {
    const db = memDb();
    expect(() => db.prepare("INSERT INTO contacts (list_id, email, domain) VALUES (999, 'a@x.com', 'x.com')").run()).toThrow(
      /FOREIGN KEY/,
    );
  });

  it("cascades contact and send deletion from a list's contacts", () => {
    const db = memDb();
    const { campaignId, contactId } = insertCampaignWithContact(db);
    db.prepare("INSERT INTO sends (campaign_id, contact_id) VALUES (?, ?)").run(campaignId, contactId);
    db.prepare("DELETE FROM contacts WHERE id = ?").run(contactId);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sends").get()).toEqual({ n: 0 });
  });

  it("rejects an unknown send state", () => {
    const db = memDb();
    const { campaignId, contactId } = insertCampaignWithContact(db);
    expect(() =>
      db.prepare("INSERT INTO sends (campaign_id, contact_id, state) VALUES (?, ?, 'bogus')").run(campaignId, contactId),
    ).toThrow(/CHECK/);
  });

  it("rejects an unknown suppression reason", () => {
    const db = memDb();
    expect(() => db.prepare("INSERT INTO suppression (email, reason) VALUES ('a@x.com', 'whim')").run()).toThrow(/CHECK/);
  });

  it("fills defaults including ISO-8601 UTC timestamps", () => {
    const db = memDb();
    const listId = insertList(db);
    const row = db.prepare("SELECT status, exclude_roles, valid_count, created_at FROM lists WHERE id = ?").get(listId);
    expect(row).toMatchObject({ status: "importing", exclude_roles: 1, valid_count: 0 });
    expect((row as { created_at: string }).created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("runMigrations", () => {
  it("is idempotent", () => {
    const db = memDb();
    const before = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
    expect(before.n).toBeGreaterThan(0);
    runMigrations(db);
    runMigrations(db);
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual(before);
  });

  it("keeps an install that already has an SMTP host on the generic SMTP provider", () => {
    const configured = memDb();
    const fresh = memDb();
    for (const db of [configured, fresh]) db.prepare("DELETE FROM schema_migrations WHERE version = 4").run();
    setSetting(configured, "smtp_host", "smtp.example.com");
    setSetting(fresh, "smtp_host", "");
    runMigrations(configured);
    runMigrations(fresh);
    expect(getSetting(configured, "provider")).toBe("smtp");
    expect(getSetting(fresh, "provider")).toBeUndefined();
  });
});

describe("openDb", () => {
  it("creates the parent directory and applies connection pragmas", () => {
    const file = path.join(dir, "nested", "deeper", "app.db");
    const db = track(openDb(file));
    expect(fs.existsSync(file)).toBe(true);
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    expect(db.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
  });
});

describe("transaction", () => {
  it("commits and returns the callback's value", () => {
    const db = memDb();
    const out = transaction(db, () => {
      setSetting(db, "k", "v");
      return 42;
    });
    expect(out).toBe(42);
    expect(getSetting(db, "k")).toBe("v");
  });

  it("rolls back and rethrows when the callback throws", () => {
    const db = memDb();
    const boom = new Error("boom");
    expect(() =>
      transaction(db, () => {
        setSetting(db, "k", "v");
        throw boom;
      }),
    ).toThrow(boom);
    expect(getSetting(db, "k")).toBeUndefined();
    expect(() => transaction(db, () => setSetting(db, "k2", "v2"))).not.toThrow();
  });

  it("rejects an async callback and rolls back its synchronous writes", () => {
    const db = memDb();
    expect(() =>
      transaction(db, () => {
        setSetting(db, "k", "v");
        return Promise.resolve();
      }),
    ).toThrow(/synchronous/);
    expect(getSetting(db, "k")).toBeUndefined();
  });
});

describe("checkIntegrity", () => {
  it("reports a healthy database as ok", () => {
    expect(checkIntegrity(memDb())).toBe(true);
  });
});

describe("backup", () => {
  it("writes archer-YYYY-MM-DD.db containing the data", () => {
    const db = track(openDb(path.join(dir, "app.db")));
    setSetting(db, "marker", "hello");
    const backupsDir = path.join(dir, "backups");

    const file = backup(db, backupsDir, new Date("2026-10-25T23:30:00Z"));

    expect(file).toBe(path.join(backupsDir, "archer-2026-10-25.db"));
    const copy = track(openDb(file));
    expect(getSetting(copy, "marker")).toBe("hello");
  });

  it("does not duplicate a backup taken the same UTC day", () => {
    const db = track(openDb(path.join(dir, "app.db")));
    const backupsDir = path.join(dir, "backups");
    const first = backup(db, backupsDir, new Date("2026-10-25T01:00:00Z"));
    setSetting(db, "marker", "later");
    const second = backup(db, backupsDir, new Date("2026-10-25T22:00:00Z"));

    expect(second).toBe(first);
    expect(fs.readdirSync(backupsDir)).toEqual(["archer-2026-10-25.db"]);
  });

  it("keeps only the seven newest daily backups", () => {
    const db = track(openDb(path.join(dir, "app.db")));
    const backupsDir = path.join(dir, "backups");
    for (let day = 1; day <= 9; day++) {
      backup(db, backupsDir, new Date(Date.UTC(2026, 9, day, 12)));
    }
    const expected = [3, 4, 5, 6, 7, 8, 9].map((d) => `archer-2026-10-0${d}.db`);
    expect(fs.readdirSync(backupsDir).sort()).toEqual(expected);
  });

  it("handles a backups path containing a single quote", () => {
    const db = track(openDb(path.join(dir, "app.db")));
    const backupsDir = path.join(dir, "o'brien", "backups");
    const file = backup(db, backupsDir, new Date("2026-10-25T12:00:00Z"));
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe("openDbWithRecovery", () => {
  it("opens a fresh database when none exists", () => {
    const dbPath = path.join(dir, "app.db");
    const r = openDbWithRecovery(dbPath, path.join(dir, "backups"));
    track(r.db);
    expect(r.restoredFrom).toBeNull();
    expect(r.quarantined).toBeNull();
    expect(getAllSettings(r.db)).toEqual({});
  });

  it("restores the newest good backup when the database file is garbage", () => {
    const dbPath = path.join(dir, "app.db");
    const backupsDir = path.join(dir, "backups");
    fs.mkdirSync(backupsDir);
    const good = path.join(backupsDir, "archer-2026-10-24.db");
    writeMarkerDb(good, "from-backup");
    fs.writeFileSync(dbPath, "not a sqlite database".repeat(200));

    const r = openDbWithRecovery(dbPath, backupsDir);
    track(r.db);

    expect(r.restoredFrom).toBe(good);
    expect(r.quarantined).toBeNull();
    expect(getSetting(r.db, "marker")).toBe("from-backup");
  });

  it("quarantines the corrupt file and starts fresh when there is no backup", () => {
    const dbPath = path.join(dir, "app.db");
    const garbage = "not a sqlite database".repeat(200);
    fs.writeFileSync(dbPath, garbage);

    const r = openDbWithRecovery(dbPath, path.join(dir, "backups"));
    track(r.db);

    expect(r.restoredFrom).toBeNull();
    expect(r.quarantined).not.toBeNull();
    expect(path.dirname(r.quarantined!)).toBe(dir);
    expect(fs.readFileSync(r.quarantined!, "utf8")).toBe(garbage);
    expect(checkIntegrity(r.db)).toBe(true);
    expect(getAllSettings(r.db)).toEqual({});
  });
});

describe("settings", () => {
  it("round-trips, overwrites, and lists values", () => {
    const db = memDb();
    expect(getSetting(db, "from_name")).toBeUndefined();
    setSetting(db, "from_name", "Mama");
    setSetting(db, "from_name", "Mama Direct");
    setSetting(db, "timezone", "America/New_York");
    expect(getSetting(db, "from_name")).toBe("Mama Direct");
    expect(getAllSettings(db)).toEqual({ from_name: "Mama Direct", timezone: "America/New_York" });
  });
});
