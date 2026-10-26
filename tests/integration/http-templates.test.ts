import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addSuppression } from "../../server/db/suppression.ts";
import { textToHtml } from "../../server/domain/template.ts";
import { signToken } from "../../server/domain/unsubscribe.ts";
import type { FetchLike, LookupFn } from "../../server/templates/linkCheck.ts";
import { startFakeSmtp, type FakeSmtp } from "../fakeSmtp.ts";
import {
  TEST_INBOXES,
  UNSUB_SECRET,
  authed,
  configureSender,
  makeHarness,
  multipart,
  mutating,
  seedList,
  type Harness,
  type HarnessOptions,
} from "./httpHarness.ts";

let h: Harness;
let smtp: FakeSmtp;
let savedTestSmtp: string | undefined;

beforeAll(() => {
  savedTestSmtp = process.env.MAMADIRECT_TEST_SMTP;
  process.env.MAMADIRECT_TEST_SMTP = "1";
});

afterAll(() => {
  if (savedTestSmtp === undefined) delete process.env.MAMADIRECT_TEST_SMTP;
  else process.env.MAMADIRECT_TEST_SMTP = savedTestSmtp;
});

beforeEach(async () => {
  smtp = await startFakeSmtp();
});

afterEach(async () => {
  await h?.close();
  await smtp.close();
});

const get = (url: string) => h.app.inject({ method: "GET", url, headers: authed });
const post = (url: string, payload?: unknown) =>
  h.app.inject({ method: "POST", url, headers: mutating, ...(payload === undefined ? {} : { payload: payload as object }) });
const put = (url: string, payload: unknown) => h.app.inject({ method: "PUT", url, headers: mutating, payload: payload as object });
const del = (url: string) => h.app.inject({ method: "DELETE", url, headers: mutating });

const COMPLIANT_HTML = '<p>Hi {{first_name | there}}</p><p><a href="{{unsubscribe_url}}">Unsubscribe</a> {{postal_address}}</p>';

async function createTemplate(body: Record<string, unknown> = {}): Promise<any> {
  const res = await post("/api/templates", { name: "Welcome", subject: "Hello {{first_name | friend}}", html: COMPLIANT_HTML, ...body });
  expect(res.statusCode).toBe(200);
  return res.json();
}

function uploadTemplate(fields: Record<string, string>, file: { filename: string; content: string | Buffer }) {
  const body = multipart(fields, { ...file, type: "application/octet-stream" });
  return h.app.inject({ method: "POST", url: "/api/templates", headers: { ...mutating, ...body.headers }, payload: body.payload });
}

describe("template CRUD", () => {
  it("creates a template from JSON and returns the full view", async () => {
    h = await makeHarness();
    const view = await createTemplate();
    expect(view).toMatchObject({
      id: expect.any(Number),
      name: "Welcome",
      version: 1,
      subject: "Hello {{first_name | friend}}",
      html: COMPLIANT_HTML,
      text: null,
      variableMap: {},
      linkCheck: null,
      testedOk: false,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(view.analysis.hasComplianceTags).toBe(true);
    expect((await get(`/api/templates/${view.id}`)).json()).toEqual(view);
    expect((await get("/api/templates")).json()).toEqual([{ id: view.id, name: "Welcome", version: 1, updatedAt: view.updatedAt }]);
  });

  it("creates a text-only template with generated HTML", async () => {
    h = await makeHarness();
    const text = "Hi {{first_name | there}},\n\nNews & updates <inside>.";
    const view = await createTemplate({ html: undefined, text });
    expect(view.text).toBe(text);
    expect(view.html).toBe(textToHtml(text));
  });

  it("rejects a template without html or text, and bad names", async () => {
    h = await makeHarness();
    const none = await post("/api/templates", { name: "X", subject: "S" });
    expect(none.statusCode).toBe(400);
    expect(none.json().error.code).toBe("invalid_request");
    expect((await post("/api/templates", { name: "", subject: "S", html: "<p>x</p>" })).statusCode).toBe(400);
    expect((await post("/api/templates", { name: "X", subject: "a\nb", html: "<p>x</p>" })).statusCode).toBe(400);
  });

  it("uploads .html and .txt files", async () => {
    h = await makeHarness();
    const html = await uploadTemplate({ name: "Up", subject: "Sub" }, { filename: "mail.HTML", content: "\uFEFF<p>Hello {{email}}</p>" });
    expect(html.statusCode).toBe(200);
    expect(html.json()).toMatchObject({ name: "Up", subject: "Sub", html: "<p>Hello {{email}}</p>", text: null, version: 1 });

    const txt = await uploadTemplate({ name: "Plain", subject: "Sub" }, { filename: "mail.txt", content: "Line one\nLine two" });
    expect(txt.statusCode).toBe(200);
    expect(txt.json()).toMatchObject({ text: "Line one\nLine two", html: textToHtml("Line one\nLine two") });
  });

  it("rejects unsupported, non-UTF-8, oversized and fieldless uploads", async () => {
    h = await makeHarness();
    const pdf = await uploadTemplate({ name: "X", subject: "S" }, { filename: "mail.pdf", content: "%PDF" });
    expect(pdf.statusCode).toBe(400);
    expect(pdf.json().error.code).toBe("unsupported_file");

    const latin1 = await uploadTemplate({ name: "X", subject: "S" }, { filename: "mail.txt", content: Buffer.from([0x63, 0x61, 0x66, 0xe9]) });
    expect(latin1.statusCode).toBe(400);
    expect(latin1.json().error.code).toBe("not_utf8");

    const big = await uploadTemplate({ name: "X", subject: "S" }, { filename: "big.html", content: "a".repeat(2 * 1024 * 1024 + 1) });
    expect(big.statusCode).toBe(413);
    expect(big.json().error.code).toBe("file_too_large");

    const noName = await uploadTemplate({ subject: "S" }, { filename: "mail.html", content: "<p>x</p>" });
    expect(noName.statusCode).toBe(400);
    expect(noName.json().error.code).toBe("invalid_request");
    expect((await get("/api/templates")).json()).toEqual([]);
  });

  it("analyses variables, malformed tags, validation and compliance tags", async () => {
    h = await makeHarness();
    const view = await createTemplate({
      subject: "Hi {{first_name}} at {{company}}",
      html: "<p>{{company | your team}} {{ broken </p>",
      text: "Plain {{city}}",
    });
    expect(view.analysis).toEqual({
      variables: [
        { name: "first_name", fallback: null, alwaysHasFallback: false, occurrences: 1 },
        { name: "company", fallback: "your team", alwaysHasFallback: false, occurrences: 2 },
        { name: "city", fallback: null, alwaysHasFallback: false, occurrences: 1 },
      ],
      malformed: [{ part: "html", problems: [{ index: 27, snippet: "{{ broken </p>" }] }],
      validation: { ok: false, unresolved: ["company", "city"], needsFallback: ["first_name"] },
      hasComplianceTags: false,
    });

    const mapped = await put(`/api/templates/${view.id}`, {
      variableMap: { company: { kind: "fixed", value: "Acme" }, city: { kind: "column", column: "city" }, first_name: { kind: "builtin", key: "first_name" } },
    });
    expect(mapped.statusCode).toBe(200);
    expect(mapped.json().analysis.validation).toEqual({ ok: false, unresolved: [], needsFallback: ["first_name", "city"] });
  });

  it("bumps the version only when content changes and clears the link check when the body changes", async () => {
    h = await makeHarness({ linkChecker: { fetchImpl: async () => new Response(null, { status: 200 }), lookup: async () => [{ address: "93.184.216.34", family: 4 }] } });
    const view = await createTemplate({ html: `${COMPLIANT_HTML}<a href="https://a.example/">a</a>` });

    const renamed = (await put(`/api/templates/${view.id}`, { name: "Renamed" })).json();
    expect(renamed).toMatchObject({ name: "Renamed", version: 1 });
    expect((await put(`/api/templates/${view.id}`, { subject: view.subject })).json().version).toBe(1);

    expect((await post(`/api/templates/${view.id}/link-check`)).statusCode).toBe(200);
    h.db.prepare("UPDATE templates SET last_test_ok_version = 1 WHERE id = ?").run(view.id);
    expect((await get(`/api/templates/${view.id}`)).json()).toMatchObject({ testedOk: true, linkCheck: { version: 1 } });

    const subject = (await put(`/api/templates/${view.id}`, { subject: "New {{first_name | x}}" })).json();
    expect(subject).toMatchObject({ version: 2, testedOk: false, linkCheck: { version: 1 } });

    const mapped = (await put(`/api/templates/${view.id}`, { variableMap: { first_name: { kind: "fixed", value: "Pal" } } })).json();
    expect(mapped).toMatchObject({ version: 3, variableMap: { first_name: { kind: "fixed", value: "Pal" } }, linkCheck: { version: 1 } });

    const body = (await put(`/api/templates/${view.id}`, { html: "<p>new</p>" })).json();
    expect(body).toMatchObject({ version: 4, html: "<p>new</p>", linkCheck: null });

    const text = (await put(`/api/templates/${view.id}`, { text: "plain" })).json();
    expect(text).toMatchObject({ version: 5, text: "plain", html: "<p>new</p>" });
    expect((await put(`/api/templates/${view.id}`, { text: null })).json()).toMatchObject({ version: 6, text: null });
  });

  it("regenerates the HTML of a text-only template when only its text is edited", async () => {
    h = await makeHarness();
    const view = await createTemplate({ html: undefined, text: "First" });
    const edited = (await put(`/api/templates/${view.id}`, { text: "Second\n\nPara" })).json();
    expect(edited).toMatchObject({ text: "Second\n\nPara", html: textToHtml("Second\n\nPara"), version: 2 });
  });

  it("validates updates and 404s unknown templates", async () => {
    h = await makeHarness();
    const view = await createTemplate();
    const badMap = await put(`/api/templates/${view.id}`, { variableMap: { x: { kind: "builtin", key: "nope" } } });
    expect(badMap.statusCode).toBe(400);
    expect((await put(`/api/templates/${view.id}`, { html: "" })).statusCode).toBe(400);
    expect((await put(`/api/templates/${view.id}`, { bogus: 1 })).statusCode).toBe(400);
    expect((await put("/api/templates/999", { name: "x" })).statusCode).toBe(404);
    expect((await get("/api/templates/999")).json().error.code).toBe("not_found");
  });

  it("deletes a template, but not while a campaign uses it", async () => {
    h = await makeHarness();
    const used = await createTemplate();
    const free = await createTemplate({ name: "Free" });
    const { listId } = seedList(h.db, [{ email: "a@b.example" }]);
    h.db
      .prepare("INSERT INTO campaigns (list_id, template_id, template_version, schedule_json) VALUES (?, ?, 1, '{}')")
      .run(listId, used.id);
    const inUse = await del(`/api/templates/${used.id}`);
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json().error.code).toBe("in_use");
    expect((await del(`/api/templates/${free.id}`)).statusCode).toBe(204);
    expect((await get(`/api/templates/${free.id}`)).statusCode).toBe(404);
    expect((await del(`/api/templates/${free.id}`)).statusCode).toBe(404);
  });
});

describe("POST /api/templates/:id/preview", () => {
  it("renders a synthetic contact with placeholders when settings are incomplete", async () => {
    h = await makeHarness();
    const view = await createTemplate({ html: "<p>Hi {{first_name | there}}</p>" });
    const res = await post(`/api/templates/${view.id}/preview`, {});
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p).toMatchObject({ contactId: null, email: "jane.doe@example.com", subject: "Hello Jane" });
    expect(p.html).toContain("<p>Hi Jane</p>");
    expect(p.html).toContain("[postal address not set]");
    expect(p.html).toContain('href="#unsubscribe"');
    expect(p.text).toContain("Unsubscribe: #unsubscribe");
  });

  it("uses the real postal address and unsubscribe link once settings are complete", async () => {
    h = await makeHarness();
    await configureSender(h, smtp.port);
    const view = await createTemplate();
    const p = (await post(`/api/templates/${view.id}/preview`, {})).json();
    expect(p.html).toContain("PO Box 1, Springfield");
    expect(p.html).toContain(`mailto:unsub@mama.example?subject=unsubscribe%20${signToken("jane.doe@example.com", UNSUB_SECRET)}`);
  });

  it("walks the list with first, next (wrapping) and random", async () => {
    h = await makeHarness();
    const { listId, contactIds } = seedList(h.db, [
      { email: "ann@x.example", fields: { first_name: "Ann" } },
      { email: "bob@x.example", fields: { first_name: "Bob" } },
      { email: "cy@x.example", fields: { first_name: "Cy" } },
    ]);
    const view = await createTemplate();
    const preview = async (body: object) => (await post(`/api/templates/${view.id}/preview`, { listId, ...body })).json();

    expect(await preview({})).toMatchObject({ contactId: contactIds[0], email: "ann@x.example", subject: "Hello Ann" });
    expect(await preview({ pick: "first" })).toMatchObject({ contactId: contactIds[0] });
    expect(await preview({ pick: "next", afterContactId: contactIds[0] })).toMatchObject({ contactId: contactIds[1], subject: "Hello Bob" });
    expect(await preview({ pick: "next", afterContactId: contactIds[2] })).toMatchObject({ contactId: contactIds[0] });
    expect(await preview({ pick: "next" })).toMatchObject({ contactId: contactIds[0] });
    for (let i = 0; i < 5; i++) expect(contactIds).toContain((await preview({ pick: "random" })).contactId);
  });

  it("falls back to the synthetic contact for an empty list and 404s an unknown list", async () => {
    h = await makeHarness();
    const { listId } = seedList(h.db, []);
    const view = await createTemplate();
    expect((await post(`/api/templates/${view.id}/preview`, { listId })).json()).toMatchObject({ contactId: null, email: "jane.doe@example.com" });
    expect((await post(`/api/templates/${view.id}/preview`, { listId: 999 })).statusCode).toBe(404);
  });

  it("returns 422 render_failed for a missing variable or a malformed tag", async () => {
    h = await makeHarness();
    const missing = await createTemplate({ subject: "Hi {{company}}" });
    const res = await post(`/api/templates/${missing.id}/preview`, {});
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: "render_failed", details: { variable: "company" } });

    const malformed = await createTemplate({ html: "<p>{{ oops</p>" });
    const bad = await post(`/api/templates/${malformed.id}/preview`, {});
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error).toMatchObject({ code: "render_failed", details: { part: "html" } });
  });
});

describe("link check", () => {
  type Hop = { status: number; location?: string };
  const routes: Record<string, Hop | Partial<Record<"HEAD" | "GET", Hop>>> = {
    "https://ok.example/": { status: 200 },
    "https://gone.example/": { status: 404 },
    "https://moved.example/": { status: 301, location: "https://moved.example/new" },
    "https://moved.example/new": { status: 200 },
    "https://nohead.example/": { HEAD: { status: 405 }, GET: { status: 200 } },
  };
  const fetchImpl: FetchLike = async (url, init) => {
    const entry = routes[url];
    const route: Hop | undefined = entry && ("status" in entry ? (entry as Hop) : entry[(init.method ?? "GET") as "HEAD" | "GET"]);
    if (!route) return new Response(null, { status: 404 });
    return new Response(null, { status: route.status, headers: route.location ? { location: route.location } : undefined });
  };
  const lookup: LookupFn = async (host) => [{ address: host === "intranet.example" ? "192.168.1.10" : "93.184.216.34", family: 4 }];
  const opts: HarnessOptions = { linkChecker: { fetchImpl, lookup } };
  const LINKS_HTML =
    `${COMPLIANT_HTML}<a href="https://ok.example/">ok</a><a href="https://gone.example/">gone</a>` +
    `<a href="https://moved.example/">moved</a><a href="https://nohead.example/">nohead</a>` +
    `<a href="https://intranet.example/">intranet</a><a href="https://x.example/?e={{email}}">var</a>`;

  it("checks every link and stores the result with the template version", async () => {
    h = await makeHarness(opts);
    const view = await createTemplate({ html: LINKS_HTML });
    const res = await post(`/api/templates/${view.id}/link-check`);
    expect(res.statusCode).toBe(200);
    const check = res.json();
    expect(check.version).toBe(1);
    expect(check.links).toEqual([
      { url: "https://ok.example/", ok: true, status: 200, finalUrl: "https://ok.example/", error: null, acknowledged: false },
      { url: "https://gone.example/", ok: false, status: 404, finalUrl: "https://gone.example/", error: "HTTP 404", acknowledged: false },
      { url: "https://moved.example/", ok: true, status: 200, finalUrl: "https://moved.example/new", error: null, acknowledged: false },
      { url: "https://nohead.example/", ok: true, status: 200, finalUrl: "https://nohead.example/", error: null, acknowledged: false },
      { url: "https://intranet.example/", ok: false, status: null, finalUrl: "https://intranet.example/", error: "private address", acknowledged: false },
      {
        url: "https://x.example/?e={{email}}",
        ok: false,
        status: null,
        finalUrl: null,
        error: "contains a template variable; it cannot be checked",
        acknowledged: false,
      },
    ]);
    expect((await get(`/api/templates/${view.id}`)).json().linkCheck).toEqual(check);
  });

  it("refuses to check more than 200 unique links", async () => {
    let fetched = 0;
    h = await makeHarness({
      linkChecker: {
        fetchImpl: async () => {
          fetched += 1;
          return new Response(null, { status: 200 });
        },
        lookup,
      },
    });
    const links = (n: number) => Array.from({ length: n }, (_, i) => `<a href="https://l${i}.example/">${i}</a>`).join("");
    const atLimit = await createTemplate({ html: COMPLIANT_HTML + links(199) + '<a href="https://x.example/?e={{email}}">v</a>' });
    expect((await post(`/api/templates/${atLimit.id}/link-check`)).statusCode).toBe(200);

    fetched = 0;
    const over = await createTemplate({ html: COMPLIANT_HTML + links(200) + '<a href="https://x.example/?e={{email}}">v</a>' });
    const res = await post(`/api/templates/${over.id}/link-check`);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("too_many_links");
    expect(fetched).toBe(0);
    expect((await get(`/api/templates/${over.id}`)).json().linkCheck).toBeNull();
  });

  it("acknowledges a link, keeps acknowledgements on re-check of the same version, and rejects unknown links", async () => {
    h = await makeHarness(opts);
    const view = await createTemplate({ html: LINKS_HTML });
    const before = await post(`/api/templates/${view.id}/link-ack`, { url: "https://gone.example/" });
    expect(before.statusCode).toBe(409);
    expect(before.json().error.code).toBe("no_link_check");

    await post(`/api/templates/${view.id}/link-check`);
    const acked = await post(`/api/templates/${view.id}/link-ack`, { url: "https://gone.example/" });
    expect(acked.statusCode).toBe(200);
    expect(acked.json().links.find((l: any) => l.url === "https://gone.example/").acknowledged).toBe(true);

    const rerun = (await post(`/api/templates/${view.id}/link-check`)).json();
    expect(rerun.links.find((l: any) => l.url === "https://gone.example/").acknowledged).toBe(true);

    const unknown = await post(`/api/templates/${view.id}/link-ack`, { url: "https://never.example/" });
    expect(unknown.statusCode).toBe(404);

    await put(`/api/templates/${view.id}`, { subject: "Changed" });
    const stale = await post(`/api/templates/${view.id}/link-ack`, { url: "https://gone.example/" });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("no_link_check");
  });
});

describe("POST /api/templates/:id/test-send", () => {
  it("sends a [TEST] copy to every test inbox through the real transport and marks the version tested", async () => {
    h = await makeHarness();
    await configureSender(h, smtp.port);
    const view = await createTemplate();
    const res = await post(`/api/templates/${view.id}/test-send`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual(
      TEST_INBOXES.map((to) => ({ to, ok: true, messageId: expect.any(String), error: null })),
    );
    expect(smtp.received.map((m) => m.to)).toEqual(TEST_INBOXES.map((to) => [to]));
    const raw = smtp.received[0].raw.replace(/\r?\n[ \t]+/g, " ");
    expect(raw).toMatch(/^Subject: \[TEST\] Hello Jane$/m);
    expect(raw).toContain(`List-Unsubscribe: <mailto:unsub@mama.example?subject=unsubscribe%20${signToken(TEST_INBOXES[0], UNSUB_SECRET)}>`);
    expect((await get(`/api/templates/${view.id}`)).json().testedOk).toBe(true);

    await put(`/api/templates/${view.id}`, { subject: "Changed {{first_name | x}}" });
    expect((await get(`/api/templates/${view.id}`)).json().testedOk).toBe(false);
  });

  it("renders with the first list contact but only ever delivers to the test inbox", async () => {
    h = await makeHarness();
    await configureSender(h, smtp.port);
    const { listId } = seedList(h.db, [{ email: "ann@x.example", fields: { first_name: "Ann" } }]);
    const view = await createTemplate();
    const res = await post(`/api/templates/${view.id}/test-send`, { to: [TEST_INBOXES[1]], listId });
    expect(res.json().results).toMatchObject([{ to: TEST_INBOXES[1], ok: true }]);
    expect(smtp.received).toHaveLength(1);
    expect(smtp.received[0].to).toEqual([TEST_INBOXES[1]]);
    expect(smtp.received[0].raw).toMatch(/^Subject: \[TEST\] Hello Ann/m);
    expect(smtp.received.some((m) => m.raw.includes("To: ann@x.example"))).toBe(false);
  });

  it("refuses addresses that are not configured test inboxes", async () => {
    h = await makeHarness();
    await configureSender(h, smtp.port);
    const view = await createTemplate();
    const res = await post(`/api/templates/${view.id}/test-send`, { to: [TEST_INBOXES[0], "stranger@else.example"] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: "not_test_inbox", details: ["stranger@else.example"] });
    expect(smtp.received).toHaveLength(0);
  });

  it("requires test inboxes and the compliance settings", async () => {
    h = await makeHarness();
    await configureSender(h, smtp.port, { testInboxes: [] });
    const view = await createTemplate();
    const none = await post(`/api/templates/${view.id}/test-send`, {});
    expect(none.statusCode).toBe(422);
    expect(none.json().error.code).toBe("no_test_inboxes");

    await configureSender(h, smtp.port, { postalAddress: "", unsubMailbox: "" });
    const missing = await post(`/api/templates/${view.id}/test-send`, {});
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error).toMatchObject({ code: "sender_incomplete", details: ["postal_address", "unsub_mailbox"] });
    expect(smtp.received).toHaveLength(0);
  });

  it("reports per-recipient failures and does not mark the version tested", async () => {
    h = await makeHarness();
    await configureSender(h, smtp.port);
    smtp.setRcptBehavior((to) => (to === TEST_INBOXES[1] ? { code: 550, message: "5.1.1 No such user" } : "accept"));
    const view = await createTemplate();
    const results = (await post(`/api/templates/${view.id}/test-send`, {})).json().results;
    expect(results[0]).toMatchObject({ to: TEST_INBOXES[0], ok: true });
    expect(results[1]).toMatchObject({ to: TEST_INBOXES[1], ok: false, messageId: null, error: expect.stringContaining("No such user") });
    expect((await get(`/api/templates/${view.id}`)).json().testedOk).toBe(false);
  });

  it("skips a suppressed test inbox and marks the version tested only when every requested inbox succeeded", async () => {
    h = await makeHarness();
    await configureSender(h, smtp.port);
    addSuppression(h.db, TEST_INBOXES[1], "unsubscribe");
    const view = await createTemplate();
    const all = await post(`/api/templates/${view.id}/test-send`, {});
    expect(all.statusCode).toBe(200);
    expect(all.json().results).toEqual([
      { to: TEST_INBOXES[0], ok: true, messageId: expect.any(String), error: null },
      { to: TEST_INBOXES[1], ok: false, messageId: null, error: "suppressed" },
    ]);
    expect(smtp.received.map((m) => m.to)).toEqual([[TEST_INBOXES[0]]]);
    expect((await get(`/api/templates/${view.id}`)).json().testedOk).toBe(false);

    const onlySuppressed = await post(`/api/templates/${view.id}/test-send`, { to: [TEST_INBOXES[1]] });
    expect(onlySuppressed.json().results).toEqual([{ to: TEST_INBOXES[1], ok: false, messageId: null, error: "suppressed" }]);
    expect(smtp.received).toHaveLength(1);
    expect((await get(`/api/templates/${view.id}`)).json().testedOk).toBe(false);

    expect((await post(`/api/templates/${view.id}/test-send`, { to: [TEST_INBOXES[0]] })).json().results[0].ok).toBe(true);
    expect((await get(`/api/templates/${view.id}`)).json().testedOk).toBe(true);
  });

  it("returns 422 render_failed when the template cannot render", async () => {
    h = await makeHarness();
    await configureSender(h, smtp.port);
    const view = await createTemplate({ subject: "Hi {{company}}" });
    const res = await post(`/api/templates/${view.id}/test-send`, {});
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("render_failed");
    expect(smtp.received).toHaveLength(0);
  });
});
