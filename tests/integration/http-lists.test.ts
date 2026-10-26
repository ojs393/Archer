import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addSuppression } from "../../server/db/suppression.ts";
import { failInterruptedImports, getList } from "../../server/import/lists.ts";
import type { DomainStatus } from "../../server/import/mx.ts";
import { authed, makeHarness, multipart, mutating, waitFor, type Harness } from "./httpHarness.ts";

let h: Harness;

afterEach(async () => {
  await h?.close();
});

const CSV = "email,first_name\r\nann@example.com,Ann\r\nnot-an-email,X\r\nANN@example.com,Dupe\r\ninfo@example.com,Role\r\nbob@dead.example,Bob\r\n";

const listFields = {
  name: "Newsletter",
  sourceLabel: "Signup form 2026",
  consentText: "They ticked the box on our signup form",
  consentConfirmed: "true",
};

function upload(fields: Record<string, string>, file?: Parameters<typeof multipart>[1]) {
  const body = multipart(fields, file);
  return h.app.inject({ method: "POST", url: "/api/lists", headers: { ...mutating, ...body.headers }, payload: body.payload });
}

function preview(content: string | Buffer) {
  const body = multipart({}, { content });
  return h.app.inject({ method: "POST", url: "/api/lists/preview", headers: { ...mutating, ...body.headers }, payload: body.payload });
}

const uploads = () => fs.readdirSync(h.paths.uploadsDir);

describe("POST /api/lists/preview", () => {
  it("previews a file with a header row", async () => {
    h = await makeHarness();
    const res = await preview(CSV);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      delimiter: ",",
      headers: ["email", "first_name"],
      headerless: false,
      rows: [
        ["ann@example.com", "Ann"],
        ["not-an-email", "X"],
        ["ANN@example.com", "Dupe"],
        ["info@example.com", "Role"],
        ["bob@dead.example", "Bob"],
      ],
      emailColumn: 0,
    });
  });

  it("previews a headerless semicolon file", async () => {
    h = await makeHarness();
    const res = await preview("\uFEFFAnn;ann@example.com\nBob;bob@example.com\n");
    expect(res.json()).toEqual({
      delimiter: ";",
      headers: ["column_1", "column_2"],
      headerless: true,
      rows: [
        ["Ann", "ann@example.com"],
        ["Bob", "bob@example.com"],
      ],
      emailColumn: 1,
    });
  });

  it("reads only the head of a large file and returns at most five rows", async () => {
    h = await makeHarness();
    const big = "email,note\n" + Array.from({ length: 20_000 }, (_, i) => `u${i}@example.com,"multi\nline ${i}"`).join("\n");
    expect(big.length).toBeGreaterThan(64 * 1024);
    const res = await preview(big);
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toHaveLength(5);
    expect(res.json().rows[0]).toEqual(["u0@example.com", "multi\nline 0"]);
  });

  it("rejects a request without a file", async () => {
    h = await makeHarness();
    const body = multipart({ name: "x" });
    const res = await h.app.inject({ method: "POST", url: "/api/lists/preview", headers: { ...mutating, ...body.headers }, payload: body.payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("file_missing");
  });

  it("rejects an empty file", async () => {
    h = await makeHarness();
    const res = await preview("");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("empty_file");
  });
});

describe("POST /api/lists", () => {
  it("accepts the upload with 202, imports in the background, reports progress over SSE, and deletes the upload", async () => {
    h = await makeHarness({
      createDomainChecker: () => async (d: string): Promise<DomainStatus> => (d === "dead.example" ? "invalid" : "ok"),
    });
    const res = await upload(listFields, { content: CSV, filename: "../../../escape.csv" });
    expect(res.statusCode).toBe(202);
    const { listId } = res.json();
    expect(typeof listId).toBe("number");
    await h.imports.idle();

    const list = getList(h.db, listId)!;
    expect(list).toMatchObject({
      name: "Newsletter",
      source_label: "Signup form 2026",
      consent_text: "They ticked the box on our signup form",
      exclude_roles: 1,
      status: "ready",
      email_column: "email",
      total_rows: 5,
      valid_count: 1,
      invalid_count: 2,
      duplicate_count: 1,
      role_count: 1,
    });
    const events = h.published.filter((e) => e.name === "import").map((e) => e.data);
    expect(events.at(-1)).toEqual({
      listId,
      phase: "done",
      rowsProcessed: 5,
      counts: { totalRows: 5, valid: 1, invalid: 2, duplicate: 1, suppressed: 0, role: 1 },
    });
    expect(events.some((e) => e.phase === "parsing")).toBe(true);
    expect(events.some((e) => e.phase === "checking_domains")).toBe(true);
    expect(uploads()).toEqual([]);
    expect(fs.existsSync(path.join(h.dir, "escape.csv"))).toBe(false);

    const detail = await h.app.inject({ method: "GET", url: `/api/lists/${listId}`, headers: authed });
    expect(detail.json()).toMatchObject({ id: listId, status: "ready", columns: ["first_name"] });
    const all = await h.app.inject({ method: "GET", url: "/api/lists", headers: authed });
    expect(all.json().map((l: { id: number }) => l.id)).toEqual([listId]);
  });

  it("honors excludeRoles=false, checkDomains=false and an #index email column", async () => {
    let checked = 0;
    h = await makeHarness({ createDomainChecker: () => async () => (checked++, "invalid" as const) });
    const res = await upload(
      { ...listFields, excludeRoles: "false", checkDomains: "false", emailColumn: "#1" },
      { content: "Ann,ann@example.com\nInfo,info@example.com\n" },
    );
    expect(res.statusCode).toBe(202);
    await h.imports.idle();
    expect(getList(h.db, res.json().listId)).toMatchObject({ status: "ready", valid_count: 2, role_count: 1, exclude_roles: 0 });
    expect(checked).toBe(0);
  });

  it("accepts the email column by header name, with fields after the file", async () => {
    h = await makeHarness();
    const body = multipart({}, { content: "name,addr\nAnn,ann@example.com\n" });
    const tail = multipart({ ...listFields, emailColumn: "addr" });
    const boundary = /boundary=(.+)$/.exec(tail.headers["content-type"])![1];
    const fileBoundary = /boundary=(.+)$/.exec(body.headers["content-type"])![1];
    const filePart = body.payload.toString().replace(`--${fileBoundary}--\r\n`, "").replaceAll(fileBoundary, boundary);
    const res = await h.app.inject({
      method: "POST",
      url: "/api/lists",
      headers: { ...mutating, ...tail.headers },
      payload: Buffer.concat([Buffer.from(filePart), tail.payload]),
    });
    expect(res.statusCode).toBe(202);
    await h.imports.idle();
    expect(getList(h.db, res.json().listId)).toMatchObject({ status: "ready", valid_count: 1, email_column: "addr" });
  });

  it("requires the consent attestation, and leaves nothing behind when refused", async () => {
    h = await makeHarness();
    const { consentConfirmed: _c, ...withoutConsent } = listFields;
    for (const fields of [withoutConsent, { ...listFields, consentConfirmed: "false" }, { ...listFields, sourceLabel: " " }, { ...listFields, bogus: "1" }]) {
      const res = await upload(fields, { content: CSV });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("invalid_request");
    }
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM lists").get()).toEqual({ n: 0 });
    expect(uploads()).toEqual([]);
  });

  it("requires a file", async () => {
    h = await makeHarness();
    const res = await upload(listFields);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("file_missing");
  });

  it("refuses a file over the size limit and removes the partial upload", async () => {
    h = await makeHarness({ uploadLimitBytes: 1024 });
    const res = await upload(listFields, { content: "email\n" + "a@example.com\n".repeat(200) });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("file_too_large");
    expect(uploads()).toEqual([]);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM lists").get()).toEqual({ n: 0 });
  });

  it("marks the list failed, reports it, and deletes the upload when the import fails", async () => {
    h = await makeHarness();
    const res = await upload({ ...listFields, emailColumn: "missing" }, { content: CSV });
    expect(res.statusCode).toBe(202);
    await h.imports.idle();
    const { listId } = res.json();
    expect(getList(h.db, listId)).toMatchObject({ status: "failed", error: expect.stringContaining("missing") });
    expect(h.published.filter((e) => e.name === "import").at(-1)!.data).toEqual({
      listId,
      phase: "failed",
      error: expect.stringContaining("missing"),
    });
    expect(uploads()).toEqual([]);
  });
});

describe("GET/DELETE /api/lists/:id", () => {
  it("404s for an unknown or malformed id", async () => {
    h = await makeHarness();
    expect((await h.app.inject({ method: "GET", url: "/api/lists/999", headers: authed })).statusCode).toBe(404);
    expect((await h.app.inject({ method: "GET", url: "/api/lists/abc", headers: authed })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "DELETE", url: "/api/lists/999", headers: mutating })).statusCode).toBe(404);
  });

  it("deletes a list, but not one a campaign uses or one still importing", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    h = await makeHarness({ createDomainChecker: () => async () => (await gate, "ok" as const) });
    const busy = (await upload(listFields, { content: CSV })).json().listId;
    await waitFor(() => h.published.some((e) => e.name === "import" && e.data.phase === "checking_domains"));
    const blocked = await h.app.inject({ method: "DELETE", url: `/api/lists/${busy}`, headers: mutating });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("import_running");
    release();
    await h.imports.idle();

    const templateId = Number(h.db.prepare("INSERT INTO templates (name, subject, html) VALUES ('T','S','<p>x</p>')").run().lastInsertRowid);
    h.db.prepare("INSERT INTO campaigns (list_id, template_id, template_version, schedule_json) VALUES (?, ?, 1, '{}')").run(busy, templateId);
    const inUse = await h.app.inject({ method: "DELETE", url: `/api/lists/${busy}`, headers: mutating });
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json().error.code).toBe("in_use");

    const free = (await upload(listFields, { content: CSV })).json().listId;
    await h.imports.idle();
    const del = await h.app.inject({ method: "DELETE", url: `/api/lists/${free}`, headers: mutating });
    expect(del.statusCode).toBe(204);
    expect(getList(h.db, free)).toBeUndefined();
  });
});

describe("failInterruptedImports", () => {
  it("fails lists left importing by a crash so they never stay stuck", async () => {
    h = await makeHarness();
    h.db.prepare("INSERT INTO lists (name, source_label, consent_text, consent_at) VALUES ('L','s','c','2026-10-01')").run();
    expect(failInterruptedImports(h.db)).toBe(1);
    expect(getList(h.db, 1)).toMatchObject({ status: "failed", error: expect.stringMatching(/interrupted/i) });
  });
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
