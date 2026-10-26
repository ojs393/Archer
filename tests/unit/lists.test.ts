import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../server/db/index.ts";
import { createList, deleteList, getList, getListColumns, listLists } from "../../server/import/lists.ts";

let db: DatabaseSync;

const INPUT = { name: "Spring leads", sourceLabel: "Trade show 2026", consentText: "They opted in", excludeRoles: true };

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

function addContact(listId: number, email: string, fields: Record<string, string>) {
  db.prepare("INSERT INTO contacts (list_id, email, domain, fields_json) VALUES (?, ?, ?, ?)").run(
    listId,
    email,
    email.split("@")[1],
    JSON.stringify(fields),
  );
}

describe("createList / getList", () => {
  it("stores the list with consent metadata and import defaults", () => {
    const before = Date.now();
    const id = createList(db, INPUT);
    const row = getList(db, id);
    expect(row).toMatchObject({
      id,
      name: "Spring leads",
      source_label: "Trade show 2026",
      consent_text: "They opted in",
      exclude_roles: 1,
      email_column: null,
      status: "importing",
      total_rows: 0,
      valid_count: 0,
      invalid_count: 0,
      duplicate_count: 0,
      suppressed_count: 0,
      role_count: 0,
      error: null,
    });
    expect(row!.consent_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(row!.consent_at)).toBeGreaterThanOrEqual(before - 1);
    expect(row!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("stores exclude_roles 0 when roles are allowed", () => {
    const id = createList(db, { ...INPUT, excludeRoles: false });
    expect(getList(db, id)!.exclude_roles).toBe(0);
  });

  it.each(["name", "sourceLabel", "consentText"] as const)("throws when %s is blank", (field) => {
    expect(() => createList(db, { ...INPUT, [field]: "   " })).toThrow(Error);
    expect(listLists(db)).toEqual([]);
  });

  it("returns undefined for an unknown id", () => {
    expect(getList(db, 9999)).toBeUndefined();
  });
});

describe("listLists", () => {
  it("returns lists newest first", () => {
    const a = createList(db, { ...INPUT, name: "A" });
    const b = createList(db, { ...INPUT, name: "B" });
    const c = createList(db, { ...INPUT, name: "C" });
    expect(listLists(db).map((l) => l.id)).toEqual([c, b, a]);
  });
});

describe("getListColumns", () => {
  it("returns the keys of the first contact's fields_json", () => {
    const id = createList(db, INPUT);
    addContact(id, "a@example.com", { first_name: "A", city: "Paris" });
    addContact(id, "b@example.com", { first_name: "B", city: "Rome" });
    expect(getListColumns(db, id)).toEqual(["first_name", "city"]);
  });

  it("returns [] for a list without contacts", () => {
    expect(getListColumns(db, createList(db, INPUT))).toEqual([]);
  });

  it("does not read another list's contacts", () => {
    const one = createList(db, INPUT);
    const two = createList(db, INPUT);
    addContact(one, "a@example.com", { first_name: "A" });
    expect(getListColumns(db, two)).toEqual([]);
  });
});

describe("deleteList", () => {
  it("deletes the list and its contacts", () => {
    const id = createList(db, INPUT);
    addContact(id, "a@example.com", {});
    deleteList(db, id);
    expect(getList(db, id)).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM contacts").get()).toEqual({ n: 0 });
  });

  it("throws a clear error and keeps the list when a campaign references it", () => {
    const id = createList(db, INPUT);
    addContact(id, "a@example.com", {});
    const templateId = Number(
      db.prepare("INSERT INTO templates (name, subject, html) VALUES ('T', 'S', '<p>h</p>')").run().lastInsertRowid,
    );
    db.prepare("INSERT INTO campaigns (list_id, template_id, template_version, schedule_json) VALUES (?, ?, 1, '{}')").run(
      id,
      templateId,
    );
    expect(() => deleteList(db, id)).toThrow(/campaign/i);
    expect(getList(db, id)).toBeDefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM contacts").get()).toEqual({ n: 1 });
  });
});
