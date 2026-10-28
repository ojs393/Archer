import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { sendsPage, swapCampaignList, swapCampaignTemplate } from "../../server/campaigns/sends.ts";
import { runMigrations } from "../../server/db/migrate.ts";
import { createList } from "../../server/import/lists.ts";

let dir: string;
let db: DatabaseSync;

function open(): DatabaseSync {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-sends-"));
  db = new DatabaseSync(path.join(dir, "t.db"));
  runMigrations(db);
  return db;
}

afterEach(() => {
  try {
    db?.close();
  } catch {
    /* closed */
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function seedTwoLists(): { campaignId: number; listA: number; listB: number; contactA1: number; contactA2: number; contactB1: number } {
  open();
  const listA = createList(db, { name: "A", sourceLabel: "csv", consentText: "ok", excludeRoles: true });
  const listB = createList(db, { name: "B", sourceLabel: "csv", consentText: "ok", excludeRoles: true });
  db.prepare("UPDATE lists SET status = 'ready', valid_count = 2 WHERE id = ?").run(listA);
  db.prepare("UPDATE lists SET status = 'ready', valid_count = 1 WHERE id = ?").run(listB);
  const contactA1 = Number(db.prepare("INSERT INTO contacts (list_id, email, domain) VALUES (?, 'ann@a.example', 'a.example')").run(listA).lastInsertRowid);
  const contactA2 = Number(db.prepare("INSERT INTO contacts (list_id, email, domain) VALUES (?, 'bob@a.example', 'a.example')").run(listA).lastInsertRowid);
  const contactB1 = Number(db.prepare("INSERT INTO contacts (list_id, email, domain) VALUES (?, 'cy@b.example', 'b.example')").run(listB).lastInsertRowid);
  db.prepare("INSERT INTO templates (name, subject, html) VALUES ('T1','s','<p>1</p>')").run();
  db.prepare("INSERT INTO templates (name, subject, html) VALUES ('T2','s','<p>2</p>')").run();
  const campaignId = Number(
    db
      .prepare(
        "INSERT INTO campaigns (list_id, template_id, template_version, schedule_json, status) VALUES (?, 1, 1, '{}', 'paused')",
      )
      .run(listA).lastInsertRowid,
  );
  db.prepare("INSERT INTO sends (campaign_id, contact_id, state, attempts) VALUES (?, ?, 'sent', 1)").run(campaignId, contactA1);
  db.prepare("INSERT INTO sends (campaign_id, contact_id, state, attempts) VALUES (?, ?, 'pending', 0)").run(campaignId, contactA2);
  return { campaignId, listA, listB, contactA1, contactA2, contactB1 };
}

describe("sendsPage", () => {
  it("filters by state and search with pagination", () => {
    const { campaignId } = seedTwoLists();
    const all = sendsPage(db, campaignId, { limit: 10, offset: 0 });
    expect(all.total).toBe(2);
    expect(all.rows.map((r) => r.email)).toEqual(["ann@a.example", "bob@a.example"]);

    const sent = sendsPage(db, campaignId, { state: "sent", limit: 10, offset: 0 });
    expect(sent.total).toBe(1);
    expect(sent.rows[0].email).toBe("ann@a.example");

    const search = sendsPage(db, campaignId, { search: "bob", limit: 10, offset: 0 });
    expect(search.total).toBe(1);
    expect(search.rows[0].state).toBe("pending");
  });
});

describe("swapCampaignList", () => {
  it("keeps sent rows and rebuilds pending from the new list", () => {
    const { campaignId, listB, contactA1, contactB1 } = seedTwoLists();
    const result = swapCampaignList(db, campaignId, listB);
    expect(result.removed).toBe(1);
    expect(result.added).toBe(1);

    const rows = sendsPage(db, campaignId, { limit: 10, offset: 0 }).rows;
    expect(rows).toHaveLength(2);
    const byId = Object.fromEntries(rows.map((r) => [r.contactId, r]));
    expect(byId[contactA1].state).toBe("sent");
    expect(byId[contactB1].state).toBe("pending");
    expect((db.prepare("SELECT list_id AS id FROM campaigns WHERE id = ?").get(campaignId) as { id: number }).id).toBe(listB);
  });
});

describe("swapCampaignTemplate", () => {
  it("updates template id and version", () => {
    const { campaignId } = seedTwoLists();
    swapCampaignTemplate(db, campaignId, 2, 1);
    const row = db.prepare("SELECT template_id AS tid, template_version AS ver FROM campaigns WHERE id = ?").get(campaignId) as {
      tid: number;
      ver: number;
    };
    expect(row).toEqual({ tid: 2, ver: 1 });
  });
});
