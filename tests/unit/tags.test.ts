import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../server/db/migrate.ts";
import { createList } from "../../server/import/lists.ts";
import {
  ensureTag,
  listAllTags,
  listTagsForList,
  normalizeTagName,
  setCampaignTags,
  setListTags,
} from "../../server/tags/store.ts";

let dir: string;
let db: DatabaseSync;

function open(): DatabaseSync {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-tags-"));
  const file = path.join(dir, "t.db");
  db = new DatabaseSync(file);
  runMigrations(db);
  return db;
}

afterEach(() => {
  try {
    db?.close();
  } catch {
    /* already closed */
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe("tags store", () => {
  it("normalizes names", () => {
    expect(normalizeTagName("  VIP ")).toBe("vip");
    expect(() => normalizeTagName("   ")).toThrow(/required/i);
  });

  it("ensures and replaces list tags", () => {
    open();
    const listId = createList(db, {
      name: "A",
      sourceLabel: "csv",
      consentText: "ok",
      excludeRoles: true,
    });
    expect(setListTags(db, listId, ["VIP", "warmup", "vip"])).toEqual(["vip", "warmup"]);
    expect(listTagsForList(db, listId)).toEqual(["vip", "warmup"]);
    expect(setListTags(db, listId, ["newsletter"])).toEqual(["newsletter"]);
    expect(listAllTags(db).map((t) => t.name).sort()).toEqual(["newsletter", "vip", "warmup"]);
  });

  it("sets campaign tags after ensureTag", () => {
    open();
    const listId = createList(db, { name: "A", sourceLabel: "csv", consentText: "ok", excludeRoles: true });
    db.prepare("INSERT INTO templates (name, subject, html) VALUES ('T','s','<p>x</p>')").run();
    const campaignId = Number(
      db
        .prepare(
          `INSERT INTO campaigns (list_id, template_id, template_version, schedule_json)
           VALUES (?, 1, 1, '{}')`,
        )
        .run(listId).lastInsertRowid,
    );
    ensureTag(db, "seed");
    expect(setCampaignTags(db, campaignId, ["seed", "demo"])).toEqual(["demo", "seed"]);
  });
});
