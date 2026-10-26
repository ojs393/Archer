import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../server/db/index.ts";
import {
  addSuppression,
  isSuppressed,
  listSuppression,
  removeSuppression,
} from "../../server/db/suppression.ts";

let db: DatabaseSync;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("addSuppression / isSuppressed", () => {
  it("returns true when newly inserted and false when already present", () => {
    expect(addSuppression(db, "jo@example.com", "unsubscribe")).toBe(true);
    expect(addSuppression(db, "jo@example.com", "manual")).toBe(false);
    const row = db.prepare("SELECT reason FROM suppression WHERE email = 'jo@example.com'").get();
    expect(row).toEqual({ reason: "unsubscribe" });
  });

  it("normalizes on both write and read", () => {
    addSuppression(db, "  Jo Smith <JO@Example.COM> ", "hard_bounce");
    expect(db.prepare("SELECT email FROM suppression").all()).toEqual([{ email: "jo@example.com" }]);
    expect(isSuppressed(db, "jo@example.com")).toBe(true);
    expect(isSuppressed(db, " JO@EXAMPLE.com ")).toBe(true);
    expect(isSuppressed(db, "mailto:jo@example.com")).toBe(true);
  });

  it("is false for addresses never added", () => {
    addSuppression(db, "jo@example.com", "complaint");
    expect(isSuppressed(db, "other@example.com")).toBe(false);
  });

  it("works across separate database handles", () => {
    const other = openDb(":memory:");
    try {
      addSuppression(other, "jo@example.com", "manual");
      expect(isSuppressed(other, "jo@example.com")).toBe(true);
      expect(isSuppressed(db, "jo@example.com")).toBe(false);
    } finally {
      other.close();
    }
  });
});

describe("removeSuppression", () => {
  it("removes a normalized match and reports whether anything was removed", () => {
    addSuppression(db, "jo@example.com", "manual");
    expect(removeSuppression(db, " JO@example.com")).toBe(true);
    expect(isSuppressed(db, "jo@example.com")).toBe(false);
    expect(removeSuppression(db, "jo@example.com")).toBe(false);
  });
});

describe("listSuppression", () => {
  beforeEach(() => {
    addSuppression(db, "alice@example.com", "unsubscribe");
    addSuppression(db, "bob@sample.org", "hard_bounce");
    addSuppression(db, "carol_x@example.com", "manual");
    addSuppression(db, "dave%x@other.net", "complaint");
  });

  it("returns rows with email, reason and created_at plus the total", () => {
    const { rows, total } = listSuppression(db, { limit: 10, offset: 0 });
    expect(total).toBe(4);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["created_at", "email", "reason"]);
      expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    expect(rows.map((r) => r.email).sort()).toEqual([
      "alice@example.com",
      "bob@sample.org",
      "carol_x@example.com",
      "dave%x@other.net",
    ]);
  });

  it("filters by case-insensitive substring; total reflects the filter", () => {
    const { rows, total } = listSuppression(db, { search: "EXAMPLE", limit: 10, offset: 0 });
    expect(total).toBe(2);
    expect(rows.map((r) => r.email).sort()).toEqual(["alice@example.com", "carol_x@example.com"]);
  });

  it("treats LIKE wildcards in the search literally", () => {
    expect(listSuppression(db, { search: "_", limit: 10, offset: 0 }).rows.map((r) => r.email)).toEqual([
      "carol_x@example.com",
    ]);
    expect(listSuppression(db, { search: "%", limit: 10, offset: 0 }).rows.map((r) => r.email)).toEqual([
      "dave%x@other.net",
    ]);
  });

  it("treats a blank search as no filter", () => {
    expect(listSuppression(db, { search: "  ", limit: 10, offset: 0 }).total).toBe(4);
  });

  it("pages with limit and offset without overlap", () => {
    const first = listSuppression(db, { limit: 2, offset: 0 });
    const second = listSuppression(db, { limit: 2, offset: 2 });
    expect(first.total).toBe(4);
    expect(first.rows).toHaveLength(2);
    expect(second.rows).toHaveLength(2);
    const all = [...first.rows, ...second.rows].map((r) => r.email);
    expect(new Set(all).size).toBe(4);
  });

  it("caps limit at 1000", () => {
    for (let i = 0; i < 1100; i++) addSuppression(db, `u${i}@bulk.com`, "manual");
    const { rows, total } = listSuppression(db, { limit: 5000, offset: 0 });
    expect(total).toBe(1104);
    expect(rows).toHaveLength(1000);
  });
});
