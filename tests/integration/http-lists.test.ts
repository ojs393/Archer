import { afterEach, describe, expect, it } from "vitest";
import { addSuppression } from "../../server/db/suppression.ts";
import { authed, makeHarness, mutating, type Harness } from "./httpHarness.ts";

let h: Harness;

afterEach(async () => {
  await h?.close();
});

describe("suppression API", () => {
  it("adds, lists, searches, and deletes", async () => {
    h = await makeHarness();
    const add = await h.app.inject({ method: "POST", url: "/api/suppression", headers: mutating, payload: { email: " Bob@Example.COM " } });
    expect(add.statusCode).toBe(201);
    expect(add.json()).toEqual({ added: true });
    const again = await h.app.inject({ method: "POST", url: "/api/suppression", headers: mutating, payload: { email: "bob@example.com", reason: "manual" } });
    expect(again.json()).toEqual({ added: false });
    addSuppression(h.db, "carol@other.org", "unsubscribe");

    const all = await h.app.inject({ method: "GET", url: "/api/suppression", headers: authed });
    expect(all.json().total).toBe(2);
    expect(all.json().rows.map((r: { email: string }) => r.email).sort()).toEqual(["bob@example.com", "carol@other.org"]);

    const search = await h.app.inject({ method: "GET", url: "/api/suppression?search=OTHER&limit=10&offset=0", headers: authed });
    expect(search.json()).toEqual({ rows: [{ email: "carol@other.org", reason: "unsubscribe", created_at: expect.any(String) }], total: 1 });

    const del = await h.app.inject({ method: "DELETE", url: `/api/suppression/${encodeURIComponent("Bob@example.com")}`, headers: mutating });
    expect(del.statusCode).toBe(204);
    const after = await h.app.inject({ method: "GET", url: "/api/suppression", headers: authed });
    expect(after.json().total).toBe(1);
  });

  it("validates input", async () => {
    h = await makeHarness();
    for (const payload of [{ email: "nope" }, { email: "a@example.com", reason: "unsubscribe" }, { email: "a@example.com", extra: 1 }, {}]) {
      const res = await h.app.inject({ method: "POST", url: "/api/suppression", headers: mutating, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    for (const qs of ["limit=1001", "limit=-1", "offset=-5", "limit=abc"]) {
      const res = await h.app.inject({ method: "GET", url: `/api/suppression?${qs}`, headers: authed });
      expect(res.statusCode, qs).toBe(400);
    }
  });

  it("exports CSV with formula-injection protection", async () => {
    h = await makeHarness();
    addSuppression(h.db, "a@example.com", "manual");
    addSuppression(h.db, "=cmd@example.com", "hard_bounce");
    const res = await h.app.inject({ method: "GET", url: "/api/suppression/export", headers: authed });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="suppression-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = res.body.trim().split(/\r?\n/);
    expect(lines[0]).toBe("email,reason,created_at");
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => l.startsWith("a@example.com,manual,"))).toBe(true);
    expect(lines.some((l) => l.startsWith("'=cmd@example.com,hard_bounce,"))).toBe(true);
  });
});
