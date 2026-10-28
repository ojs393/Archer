import type { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSecret } from "../../server/logger.ts";
import { authed, makeHarness, seedList, type Harness } from "./httpHarness.ts";

const NOW = new Date("2026-10-26T12:30:00.000Z");
const SECRET = "Analytics-Secret-Value-9f2c";

let h: Harness;
let ids: { a: number; b: number; c: number };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  registerSecret(SECRET);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  h = await makeHarness();
  ids = seed(h.db);
});

afterEach(async () => {
  await h?.close();
});

type SendState = "pending" | "sending" | "sent" | "retry" | "failed" | "uncertain" | "skipped_suppressed";

function template(db: DatabaseSync, name: string): number {
  return Number(db.prepare("INSERT INTO templates (name, subject, html) VALUES (?, 'S', '<p>x</p>')").run(name).lastInsertRowid);
}

function renameList(db: DatabaseSync, listId: number, name: string): void {
  db.prepare("UPDATE lists SET name = ? WHERE id = ?").run(name, listId);
}

function campaign(
  db: DatabaseSync,
  c: { listId: number; templateId: number; status: string; createdAt: string; startedAt?: string; finishedAt?: string },
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO campaigns (list_id, template_id, template_version, status, schedule_json, created_at, started_at, finished_at)
         VALUES (?, ?, 1, ?, '{}', ?, ?, ?)`,
      )
      .run(c.listId, c.templateId, c.status, c.createdAt, c.startedAt ?? null, c.finishedAt ?? null).lastInsertRowid,
  );
}

function sends(db: DatabaseSync, campaignId: number, contactIds: number[], states: SendState[]): void {
  const insert = db.prepare("INSERT INTO sends (campaign_id, contact_id, state) VALUES (?, ?, ?)");
  states.forEach((state, i) => insert.run(campaignId, contactIds[i], state));
}

function event(db: DatabaseSync, campaignId: number, type: string, at: string, message = `${type} event`): void {
  db.prepare("INSERT INTO events (campaign_id, type, message, created_at) VALUES (?, ?, ?, ?)").run(campaignId, type, message, at);
}

function suppress(db: DatabaseSync, email: string, reason: string): void {
  db.prepare("INSERT INTO suppression (email, reason) VALUES (?, ?)").run(email, reason);
}

function seed(db: DatabaseSync): { a: number; b: number; c: number } {
  const listA = seedList(db, Array.from({ length: 10 }, (_, i) => ({ email: `a${i + 1}@x.example` })));
  const listB = seedList(db, Array.from({ length: 6 }, (_, i) => ({ email: `b${i + 1}@y.example` })));
  renameList(db, listA.listId, "Spring list");
  renameList(db, listB.listId, "Autumn list");
  const welcome = template(db, "Welcome");
  const promo = template(db, "Promo");

  const a = campaign(db, {
    listId: listA.listId,
    templateId: welcome,
    status: "completed",
    createdAt: "2026-10-25T08:00:00.000Z",
    startedAt: "2026-10-26T10:00:00.000Z",
    finishedAt: "2026-10-26T12:05:00.000Z",
  });
  const b = campaign(db, {
    listId: listB.listId,
    templateId: promo,
    status: "paused",
    createdAt: "2026-10-25T09:00:00.000Z",
    startedAt: "2026-10-20T07:00:00.000Z",
  });
  const c = campaign(db, { listId: listA.listId, templateId: promo, status: "draft", createdAt: "2026-10-26T12:00:00.000Z" });

  sends(db, a, listA.contactIds, ["sent", "sent", "sent", "sent", "sent", "failed", "failed", "retry", "uncertain", "pending"]);
  suppress(db, "a6@x.example", "manual");
  suppress(db, "a7@x.example", "hard_bounce");
  sends(db, b, listB.contactIds, ["sent", "sent", "sent", "skipped_suppressed", "failed", "sending"]);
  suppress(db, "b4@y.example", "unsubscribe");
  suppress(db, "b5@y.example", "hard_bounce");

  event(db, a, "status", "2026-10-26T10:00:00.000Z", "Status: running");
  event(db, a, "sent", "2026-10-26T10:05:00.000Z");
  event(db, a, "sent", "2026-10-26T10:20:00.000Z");
  event(db, a, "failed", "2026-10-26T10:59:59.999Z", "Failed a6@x.example: 550 5.1.1 <a6@x.example>   mailbox\n unavailable");
  event(db, a, "sent", "2026-10-26T11:10:00.000Z");
  event(db, a, "sent", "2026-10-26T11:10:00.000Z");
  event(db, a, "suppressed", "2026-10-26T11:15:00.000Z", "Suppressed a7@x.example: 550 5.1.1 user unknown");
  event(db, a, "retry", "2026-10-26T11:16:00.000Z", "Retry 2/5 for a8@x.example at 2026-10-26T11:30:00.000Z: 421 try again later");
  event(db, a, "retry", "2026-10-26T11:50:00.000Z", "Retry 3/5 for a8@x.example at 2026-10-26T12:10:00.000Z: 421 try again later");
  event(db, a, "sent", "2026-10-26T12:01:00.000Z");
  event(db, a, "uncertain", "2026-10-26T12:02:00.000Z", "Uncertain a9@x.example: no reply within 60s; it may have been delivered. Not resent automatically.");
  event(db, a, "error", "2026-10-26T12:03:00.000Z", "SMTP login failed: bad password");

  event(db, b, "sent", "2026-10-20T08:00:00.000Z");
  event(db, b, "sent", "2026-10-26T09:30:00.000Z");
  event(db, b, "sent", "2026-10-26T09:30:00.000Z");
  event(db, b, "sent", "2026-10-26T09:45:00.000Z");
  event(db, b, "skipped", "2026-10-26T09:46:00.000Z", "Skipped b4@y.example: on the suppression list");
  event(db, b, "suppressed", "2026-10-26T11:40:00.000Z", "Suppressed b5@y.example: 550 5.1.1 user unknown");
  return { a, b, c };
}

const get = (url: string) => h.app.inject({ method: "GET", url, headers: authed });

const zeros = { sent: 0, failed: 0, suppressed: 0, retry: 0, uncertain: 0 };

describe("GET /api/analytics/summary", () => {
  it("totals every run and rates over attempted outcomes", async () => {
    const res = await get("/api/analytics/summary");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      totals: { recipients: 16, sent: 8, failed: 1, suppressed: 2, retry: 1, uncertain: 1, skipped: 1, pending: 2 },
      rates: { deliveryRate: 8 / 11, bounceRate: 2 / 11, rejectionRate: 3 / 11 },
      lastSendAt: "2026-10-26T12:01:00.000Z",
    });
  });

  it("scopes to one run", async () => {
    expect((await get(`/api/analytics/summary?campaignId=${ids.a}`)).json()).toEqual({
      totals: { recipients: 10, sent: 5, failed: 1, suppressed: 1, retry: 1, uncertain: 1, skipped: 0, pending: 1 },
      rates: { deliveryRate: 5 / 7, bounceRate: 1 / 7, rejectionRate: 2 / 7 },
      lastSendAt: "2026-10-26T12:01:00.000Z",
    });
    expect((await get(`/api/analytics/summary?campaignId=${ids.b}`)).json().lastSendAt).toBe("2026-10-26T09:45:00.000Z");
  });

  it("reports zero rates and no last send for a run without attempts", async () => {
    expect((await get(`/api/analytics/summary?campaignId=${ids.c}`)).json()).toEqual({
      totals: { recipients: 0, sent: 0, failed: 0, suppressed: 0, retry: 0, uncertain: 0, skipped: 0, pending: 0 },
      rates: { deliveryRate: 0, bounceRate: 0, rejectionRate: 0 },
      lastSendAt: null,
    });
  });
});

describe("GET /api/analytics/timeseries", () => {
  it("defaults to 48 zero-filled hourly buckets ending with the current hour", async () => {
    const res = await get("/api/analytics/timeseries");
    expect(res.statusCode).toBe(200);
    const { bucket, points } = res.json();
    expect(bucket).toBe("hour");
    expect(points).toHaveLength(48);
    expect(points[0]).toEqual({ t: "2026-10-24T13:00:00.000Z", ...zeros });
    expect(points.at(-1).t).toBe("2026-10-26T12:00:00.000Z");
    const byT = Object.fromEntries(points.map((p: { t: string }) => [p.t, p]));
    expect(byT["2026-10-26T08:00:00.000Z"]).toEqual({ t: "2026-10-26T08:00:00.000Z", ...zeros });
    expect(byT["2026-10-26T09:00:00.000Z"]).toEqual({ t: "2026-10-26T09:00:00.000Z", ...zeros, sent: 3 });
    expect(byT["2026-10-26T10:00:00.000Z"]).toEqual({ t: "2026-10-26T10:00:00.000Z", ...zeros, sent: 2, failed: 1 });
    expect(byT["2026-10-26T11:00:00.000Z"]).toEqual({ t: "2026-10-26T11:00:00.000Z", ...zeros, sent: 2, suppressed: 2, retry: 2 });
    expect(byT["2026-10-26T12:00:00.000Z"]).toEqual({ t: "2026-10-26T12:00:00.000Z", ...zeros, sent: 1, uncertain: 1 });
    const hours = points.map((p: { t: string }) => Date.parse(p.t));
    expect(hours.every((t: number, i: number) => i === 0 || t - hours[i - 1] === 3_600_000)).toBe(true);
  });

  it("buckets by UTC day over 30 days by default", async () => {
    const { bucket, points } = (await get("/api/analytics/timeseries?bucket=day")).json();
    expect(bucket).toBe("day");
    expect(points).toHaveLength(30);
    expect(points[0].t).toBe("2026-09-27T00:00:00.000Z");
    expect(points.at(-1)).toEqual({ t: "2026-10-26T00:00:00.000Z", sent: 8, failed: 1, suppressed: 2, retry: 2, uncertain: 1 });
    expect(points.find((p: { t: string }) => p.t === "2026-10-20T00:00:00.000Z")).toEqual({ t: "2026-10-20T00:00:00.000Z", ...zeros, sent: 1 });
  });

  it("honours days, caps at 2,160 points and scopes to one run", async () => {
    expect((await get("/api/analytics/timeseries?bucket=hour&days=1")).json().points).toHaveLength(24);
    expect((await get("/api/analytics/timeseries?bucket=hour&days=90")).json().points).toHaveLength(2160);
    expect((await get("/api/analytics/timeseries?bucket=day&days=7")).json().points).toHaveLength(7);
    const scoped = (await get(`/api/analytics/timeseries?campaignId=${ids.b}`)).json().points;
    const totals = scoped.reduce(
      (sum: typeof zeros, p: typeof zeros) => ({
        sent: sum.sent + p.sent,
        failed: sum.failed + p.failed,
        suppressed: sum.suppressed + p.suppressed,
        retry: sum.retry + p.retry,
        uncertain: sum.uncertain + p.uncertain,
      }),
      zeros,
    );
    expect(totals).toEqual({ ...zeros, sent: 3, suppressed: 1 });
  });

  it("supports minute buckets and hours lookback", async () => {
    const half = (await get("/api/analytics/timeseries?bucket=minute&hours=0.5")).json();
    expect(half.bucket).toBe("minute");
    expect(half.points).toHaveLength(30);
    const six = (await get("/api/analytics/timeseries?bucket=hour&hours=6")).json();
    expect(six.points).toHaveLength(6);
    const year = (await get("/api/analytics/timeseries?bucket=day&days=365")).json();
    expect(year.points).toHaveLength(365);
  });

  it.each(["bucket=week", "days=0", "days=367", "days=1.5", "hours=0", "campaignId=0", "extra=1"])(
    "rejects %s",
    async (query) => {
      const res = await get(`/api/analytics/timeseries?${query}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("invalid_request");
    },
  );
});

describe("GET /api/analytics/errors", () => {
  it("groups outcomes by normalized message with addresses redacted", async () => {
    const res = await get("/api/analytics/errors");
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toEqual([
      { kind: "retry", message: "Retry for <email> at <time>: 421 try again later", count: 2, lastAt: "2026-10-26T11:50:00.000Z" },
      { kind: "suppressed", message: "Suppressed <email>: 550 5.1.1 user unknown", count: 2, lastAt: "2026-10-26T11:40:00.000Z" },
      {
        kind: "uncertain",
        message: "Uncertain <email>: no reply within 60s; it may have been delivered. Not resent automatically.",
        count: 1,
        lastAt: "2026-10-26T12:02:00.000Z",
      },
      { kind: "failed", message: "Failed <email>: 550 5.1.1 <email> mailbox unavailable", count: 1, lastAt: "2026-10-26T10:59:59.999Z" },
    ]);
    expect(res.body).not.toMatch(/@(x|y)\.example/);
  });

  it("limits rows, scopes to one run, caps messages at 160 characters and masks secrets", async () => {
    event(h.db, ids.b, "failed", "2026-10-26T12:10:00.000Z", `Failed b6@y.example: rejected ${SECRET} ${"z".repeat(300)}`);
    const limited = (await get("/api/analytics/errors?limit=2")).json().rows;
    expect(limited.map((r: { kind: string }) => r.kind)).toEqual(["retry", "suppressed"]);

    const scoped = (await get(`/api/analytics/errors?campaignId=${ids.b}`)).json();
    expect(scoped.rows).toHaveLength(2);
    const long = scoped.rows.find((r: { kind: string }) => r.kind === "failed");
    expect(long.message).toHaveLength(160);
    expect(long.message.startsWith("Failed <email>: rejected *** zzz")).toBe(true);
    expect(JSON.stringify(scoped)).not.toContain(SECRET);
    expect(scoped.rows.find((r: { kind: string }) => r.kind === "suppressed")).toMatchObject({ count: 1 });
  });

  it.each(["limit=0", "limit=51", "kind=failed"])("rejects %s", async (query) => {
    expect((await get(`/api/analytics/errors?${query}`)).statusCode).toBe(400);
  });
});

describe("GET /api/analytics/runs", () => {
  it("lists runs newest first with their outcome counts", async () => {
    const res = await get("/api/analytics/runs");
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toEqual([
      {
        id: ids.c,
        name: "Spring list · Promo",
        status: "draft",
        recipients: 0,
        sent: 0,
        failed: 0,
        suppressed: 0,
        uncertain: 0,
        deliveryRate: 0,
        startedAt: null,
        finishedAt: null,
      },
      {
        id: ids.b,
        name: "Autumn list · Promo",
        status: "paused",
        recipients: 6,
        sent: 3,
        failed: 0,
        suppressed: 1,
        uncertain: 0,
        deliveryRate: 3 / 4,
        startedAt: "2026-10-20T07:00:00.000Z",
        finishedAt: null,
      },
      {
        id: ids.a,
        name: "Spring list · Welcome",
        status: "completed",
        recipients: 10,
        sent: 5,
        failed: 1,
        suppressed: 1,
        uncertain: 1,
        deliveryRate: 5 / 7,
        startedAt: "2026-10-26T10:00:00.000Z",
        finishedAt: "2026-10-26T12:05:00.000Z",
      },
    ]);
  });

  it("scopes to one run and returns at most 100 rows", async () => {
    const scoped = (await get(`/api/analytics/runs?campaignId=${ids.b}`)).json().rows;
    expect(scoped.map((r: { id: number }) => r.id)).toEqual([ids.b]);

    const insert = h.db.prepare(
      "INSERT INTO campaigns (list_id, template_id, template_version, status, schedule_json, created_at) VALUES (1, 1, 1, 'draft', '{}', ?)",
    );
    for (let i = 0; i < 120; i++) insert.run(`2026-10-26T12:${String(10 + (i % 50)).padStart(2, "0")}:00.000Z`);
    const rows = (await get("/api/analytics/runs")).json().rows as { id: number }[];
    expect(rows).toHaveLength(100);
    expect(rows.map((r) => r.id)).not.toContain(ids.a);
  });
});

describe("GET /api/analytics/feedback", () => {
  it("reports zero counts and setup guidance until SNS events arrive", async () => {
    const res = await get("/api/analytics/feedback");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["available", "bounces", "complaints", "endpoint", "guidance", "reason"]);
    expect(body.available).toBe(false);
    expect(body.complaints).toBe(0);
    expect(body.bounces).toBe(0);
    expect(body.endpoint).toBe("/sns");
    expect(body.reason).toMatch(/SNS|\/sns/);
    expect(body.guidance.length).toBeGreaterThanOrEqual(3);
    for (const line of body.guidance) expect(typeof line).toBe("string");
  });

  it("marks feedback available once SNS events are stored", async () => {
    h.db.prepare("INSERT INTO feedback_events (kind, email, detail, message_id) VALUES ('complaint', 'a@x.com', 'abuse', 'm1')").run();
    h.db.prepare("INSERT INTO feedback_events (kind, email, detail, message_id) VALUES ('bounce', 'b@x.com', 'Permanent', 'm2')").run();
    const body = (await get("/api/analytics/feedback")).json();
    expect(body.available).toBe(true);
    expect(body.complaints).toBe(1);
    expect(body.bounces).toBe(1);
  });
});

describe("event ring coverage", () => {
  const trimThrough = (id: number) => h.db.prepare("DELETE FROM events WHERE id <= ?").run(id);
  const eventId = (campaignId: number, at: string) =>
    (h.db.prepare("SELECT id FROM events WHERE campaign_id = ? AND created_at = ? ORDER BY id LIMIT 1").get(campaignId, at) as { id: number }).id;

  it("reports the oldest kept event in scope on timeseries and errors", async () => {
    expect((await get("/api/analytics/timeseries")).json().coverageFrom).toBe("2026-10-20T08:00:00.000Z");
    expect((await get("/api/analytics/errors")).json().coverageFrom).toBe("2026-10-20T08:00:00.000Z");
    expect((await get(`/api/analytics/timeseries?campaignId=${ids.a}&bucket=day`)).json().coverageFrom).toBe("2026-10-26T10:00:00.000Z");
    expect((await get(`/api/analytics/errors?campaignId=${ids.a}`)).json().coverageFrom).toBe("2026-10-26T10:00:00.000Z");
    expect((await get(`/api/analytics/timeseries?campaignId=${ids.c}`)).json().coverageFrom).toBeNull();
  });

  it("moves coverageFrom forward once the ring has dropped older events", async () => {
    trimThrough(eventId(ids.b, "2026-10-26T09:30:00.000Z"));
    const ts = (await get("/api/analytics/timeseries")).json();
    expect(ts.coverageFrom).toBe("2026-10-26T09:30:00.000Z");
    expect(ts.points.find((p: { t: string }) => p.t === "2026-10-26T09:00:00.000Z").sent).toBe(2);
    expect((await get("/api/analytics/errors")).json().coverageFrom).toBe("2026-10-26T09:30:00.000Z");
    expect((await get(`/api/analytics/timeseries?campaignId=${ids.a}`)).json().coverageFrom).toBeNull();
    expect((await get(`/api/analytics/errors?campaignId=${ids.a}`)).json()).toEqual({ coverageFrom: null, rows: [] });
  });

  it("falls back to the newest sent row for lastSendAt when no sent event is kept", async () => {
    const setUpdated = h.db.prepare("UPDATE sends SET updated_at = ? WHERE campaign_id = ? AND contact_id = ?");
    const contactsOf = (campaignId: number, state: string) =>
      (h.db.prepare("SELECT contact_id FROM sends WHERE campaign_id = ? AND state = ? ORDER BY contact_id").all(campaignId, state) as { contact_id: number }[]).map(
        (r) => r.contact_id,
      );
    const sentA = contactsOf(ids.a, "sent");
    sentA.forEach((contactId, i) => setUpdated.run(`2026-09-0${i + 1}T10:00:00.000Z`, ids.a, contactId));
    setUpdated.run("2026-09-30T00:00:00.000Z", ids.a, contactsOf(ids.a, "failed")[0]);
    contactsOf(ids.b, "sent").forEach((contactId) => setUpdated.run("2026-09-20T00:00:00.000Z", ids.b, contactId));

    trimThrough(eventId(ids.a, "2026-10-26T12:03:00.000Z"));
    const scoped = (await get(`/api/analytics/summary?campaignId=${ids.a}`)).json();
    expect(scoped.lastSendAt).toBe(`2026-09-0${sentA.length}T10:00:00.000Z`);
    expect((await get(`/api/analytics/summary?campaignId=${ids.b}`)).json().lastSendAt).toBe("2026-10-26T09:45:00.000Z");

    h.db.prepare("DELETE FROM events").run();
    expect((await get("/api/analytics/summary")).json().lastSendAt).toBe("2026-09-20T00:00:00.000Z");
    expect((await get(`/api/analytics/summary?campaignId=${ids.c}`)).json().lastSendAt).toBeNull();
  });
});

describe("analytics scoping and security", () => {
  it.each(["summary", "timeseries", "errors", "runs"])("answers 404 for an unknown campaign on %s", async (route) => {
    const res = await get(`/api/analytics/${route}?campaignId=999`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });

  it("needs the session cookie", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/analytics/summary", headers: { host: authed.host } });
    expect(res.statusCode).toBe(401);
  });
});
