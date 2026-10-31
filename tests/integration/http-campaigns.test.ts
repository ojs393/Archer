import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setSetting } from "../../server/db/settings.ts";
import type { Schedule } from "../../server/domain/schedule.ts";
import type { HealthItem } from "../../server/http/contract.ts";
import { wireWorkerEvents } from "../../server/http/status.ts";
import type { WorkerDeps } from "../../server/send/worker.ts";
import { startFakeSmtp, type FakeSmtp } from "../fakeSmtp.ts";
import {
  TEST_INBOXES,
  authed,
  configureSender,
  makeHarness,
  mutating,
  seedList,
  waitFor,
  type Harness,
  type SeedContact,
} from "./httpHarness.ts";

let h: Harness;
let smtp: FakeSmtp;
let savedTestSmtp: string | undefined;
let nowMs: number;

beforeAll(() => {
  savedTestSmtp = process.env.ARCHER_TEST_SMTP;
  process.env.ARCHER_TEST_SMTP = "1";
});

afterAll(() => {
  if (savedTestSmtp === undefined) delete process.env.ARCHER_TEST_SMTP;
  else process.env.ARCHER_TEST_SMTP = savedTestSmtp;
});

beforeEach(async () => {
  smtp = await startFakeSmtp();
  nowMs = Date.parse("2026-10-26T10:00:00Z");
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

const ALL_DAY: Schedule = {
  timezone: "UTC",
  sendDays: [0, 1, 2, 3, 4, 5, 6],
  startTime: "00:00",
  endTime: "23:59",
  dailyCap: 2000,
  warmup: false,
  delaySeconds: 1,
};

const CONTACTS = [
  { email: "ann@x.example", fields: { first_name: "Ann" } },
  { email: "bob@x.example", fields: { first_name: "Bob" } },
  { email: "cy@x.example", fields: { first_name: "Cy" } },
];

const fastClock: Partial<WorkerDeps> = {
  now: () => new Date(nowMs),
  sleep: async (ms) => {
    nowMs += ms;
    await new Promise((resolve) => setImmediate(resolve));
  },
  random: () => 0.5,
  probeNetwork: async () => true,
};

const heldClock: Partial<WorkerDeps> = {
  now: () => new Date(nowMs),
  random: () => 0.5,
  probeNetwork: async () => true,
  sleep: (_ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      signal.addEventListener("abort", () => resolve(), { once: true });
    }),
};

const ok = (detail: string): HealthItem => ({ status: "ok", detail, checkedAt: new Date().toISOString() });

async function setup(workerDeps: Partial<WorkerDeps> = fastClock) {
  h = await makeHarness({
    workerDeps,
    linkChecker: { fetchImpl: async () => new Response(null, { status: 200 }), lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
  });
  wireWorkerEvents({ db: h.db, worker: h.worker, events: h.events, health: h.health });
  await configureSender(h, smtp.port);
  h.health.set("smtp", ok("Connected"));
  h.health.set("dns", ok("SPF, DKIM and DMARC found for mama.example"));
}

async function readyTemplate(): Promise<number> {
  const res = await post("/api/templates", {
    name: "Welcome",
    subject: "Hello {{first_name | friend}}",
    html: '<p>Hi {{first_name | there}}</p><a href="https://site.example/">site</a>',
  });
  const id = res.json().id as number;
  expect((await post(`/api/templates/${id}/link-check`)).statusCode).toBe(200);
  expect((await post(`/api/templates/${id}/test-send`, {})).json().results.every((r: any) => r.ok)).toBe(true);
  smtp.received.length = 0;
  return id;
}

async function readyCampaign(contacts: SeedContact[] = CONTACTS, schedule: Schedule = ALL_DAY) {
  h.db.exec("BEGIN");
  const { listId, contactIds } = seedList(h.db, contacts);
  h.db.exec("COMMIT");
  const templateId = await readyTemplate();
  const res = await post("/api/campaigns", { listId, templateId, schedule });
  expect(res.statusCode).toBe(201);
  return { listId, contactIds, templateId, campaign: res.json() };
}

const gates = async (id: number) => (await get(`/api/campaigns/${id}/gates`)).json();
const status = (id: number) => (h.db.prepare("SELECT status FROM campaigns WHERE id = ?").get(id) as { status: string }).status;

describe("POST/GET /api/campaigns", () => {
  it("creates a draft with one sends row per contact", async () => {
    await setup();
    const { listId, templateId, campaign } = await readyCampaign();
    expect(campaign).toMatchObject({
      listId,
      templateId,
      templateVersion: 1,
      status: "draft",
      pauseReason: null,
      schedule: ALL_DAY,
      startedAt: null,
      finishedAt: null,
      counts: { pending: 3, total: 3, sent: 0 },
      stats: { sentLastHour: 0, rejectionRate: 0, sample: 0 },
    });
    expect(campaign.estimate.perDay.reduce((n: number, d: any) => n + d.count, 0)).toBe(3);
    expect((await get(`/api/campaigns/${campaign.id}`)).json()).toEqual(campaign);
    expect((await get("/api/campaigns")).json()).toEqual([campaign]);
  });

  it("inserts send rows in batches for a list larger than one batch", async () => {
    await setup();
    const contacts = Array.from({ length: 2345 }, (_, i) => ({ email: `u${i}@x.example` }));
    const { campaign } = await readyCampaign(contacts);
    expect(campaign.counts).toMatchObject({ pending: 2345, total: 2345 });
  });

  it("refuses a list that is not ready, unknown ids and invalid schedules", async () => {
    await setup();
    const templateId = await readyTemplate();
    const importing = seedList(h.db, CONTACTS.slice(0, 1), "importing").listId;
    const notReady = await post("/api/campaigns", { listId: importing, templateId, schedule: ALL_DAY });
    expect(notReady.statusCode).toBe(409);
    expect(notReady.json().error.code).toBe("list_not_ready");

    const { listId } = seedList(h.db, CONTACTS);
    expect((await post("/api/campaigns", { listId: 999, templateId, schedule: ALL_DAY })).statusCode).toBe(404);
    expect((await post("/api/campaigns", { listId, templateId: 999, schedule: ALL_DAY })).statusCode).toBe(404);
    const bad = await post("/api/campaigns", { listId, templateId, schedule: { ...ALL_DAY, endTime: "00:00" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details[0].message).toBe("End time must be after start time.");
    expect((await get("/api/campaigns/999")).statusCode).toBe(404);
    expect((await get("/api/campaigns")).json()).toEqual([]);
  });
});

describe("campaign creation completeness", () => {
  it("refuses start, resume, delete, schedule changes and requeue while the campaign is still being created", async () => {
    await setup();
    const templateId = await readyTemplate();
    h.db.exec("BEGIN");
    const { listId } = seedList(h.db, Array.from({ length: 20_000 }, (_, i) => ({ email: `u${i}@x.example` })));
    h.db.exec("COMMIT");

    const creating = post("/api/campaigns", { listId, templateId, schedule: ALL_DAY });
    let id: number | undefined;
    while (id === undefined) {
      await new Promise((resolve) => setImmediate(resolve));
      id = (h.db.prepare("SELECT id FROM campaigns").get() as { id: number } | undefined)?.id;
    }
    const attempts = await Promise.all([
      post(`/api/campaigns/${id}/start`),
      post(`/api/campaigns/${id}/resume`),
      del(`/api/campaigns/${id}`),
      put(`/api/campaigns/${id}/schedule`, { schedule: ALL_DAY }),
      post(`/api/campaigns/${id}/requeue`, {}),
    ]);
    for (const r of attempts) {
      expect(r.statusCode).toBe(409);
      expect(r.json().error.code).toBe("creating");
    }

    const created = await creating;
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id, status: "draft", counts: { pending: 20_000, total: 20_000 } });
    expect((await gates(id)).gates.find((g: any) => g.key === "has_recipients").ok).toBe(true);
    expect((await del(`/api/campaigns/${id}`)).statusCode).toBe(204);
  });

  it("fails has_recipients for a campaign with fewer sends rows than list contacts", async () => {
    await setup();
    const { campaign, contactIds } = await readyCampaign();
    h.db.prepare("DELETE FROM sends WHERE campaign_id = ? AND contact_id = ?").run(campaign.id, contactIds[2]);
    const result = await gates(campaign.id);
    expect(result.ok).toBe(false);
    expect(result.gates.find((g: any) => g.key === "has_recipients")).toEqual({
      key: "has_recipients",
      ok: false,
      message: "This campaign was not fully created (2 of 3 recipients); delete it and create it again.",
    });
    const start = await post(`/api/campaigns/${campaign.id}/start`);
    expect(start.statusCode).toBe(409);
    expect(start.json().error.code).toBe("gates_failed");
  });
});

describe("launch gates", () => {
  it("passes every gate once everything is set up", async () => {
    await setup();
    const { campaign } = await readyCampaign();
    const result = await gates(campaign.id);
    expect(result.gates.map((g: any) => g.key)).toEqual([
      "list_ready",
      "has_recipients",
      "from_name",
      "from_email",
      "postal_address",
      "unsub_mailbox",
      "smtp_verified",
      "dns_ok",
      "variables_resolved",
      "no_malformed_tags",
      "links_ok",
      "test_send_ok",
      "schedule_valid",
    ]);
    expect(result.gates.filter((g: any) => !g.ok)).toEqual([]);
    expect(result.ok).toBe(true);
    for (const g of result.gates) expect(g.message).toEqual(expect.any(String));
  });

  it("fails each gate on its own with a message saying what to fix", async () => {
    await setup();
    const { campaign, listId, templateId } = await readyCampaign();
    const id = campaign.id;
    const sql = (q: string, ...args: (string | number | null)[]) => h.db.prepare(q).run(...args);
    const cases: [string, () => void | Promise<void>, () => void | Promise<void>, RegExp][] = [
      ["list_ready", () => sql("UPDATE lists SET status = 'importing' WHERE id = ?", listId), () => sql("UPDATE lists SET status = 'ready' WHERE id = ?", listId), /still importing/],
      ["has_recipients", () => sql("UPDATE sends SET state = 'sent' WHERE campaign_id = ?", id), () => sql("UPDATE sends SET state = 'pending' WHERE campaign_id = ?", id), /nobody is left/i],
      ["from_name", () => setSetting(h.db, "from_name", "  "), () => setSetting(h.db, "from_name", "Mama Direct"), /from name/],
      ["from_email", () => setSetting(h.db, "from_email", ""), () => setSetting(h.db, "from_email", "hello@mama.example"), /from address/],
      ["postal_address", () => setSetting(h.db, "postal_address", "  "), () => setSetting(h.db, "postal_address", "PO Box 1"), /postal address/],
      ["unsub_mailbox", () => setSetting(h.db, "unsub_mailbox", "nope"), () => setSetting(h.db, "unsub_mailbox", "unsub@mama.example"), /unsubscribe mailbox/],
      ["smtp_verified", () => h.health.reset("smtp"), () => h.health.set("smtp", ok("Connected")), /Test connection/],
      ["dns_ok", () => h.health.set("dns", { status: "fail", detail: "SPF: missing", checkedAt: null }), () => h.health.set("dns", ok("fine")), /SPF: missing/],
      ["variables_resolved", () => sql("UPDATE templates SET subject = 'Hi {{company}}' WHERE id = ?", templateId), () => sql("UPDATE templates SET subject = 'Hello' WHERE id = ?", templateId), /\{\{company\}\}/],
      ["no_malformed_tags", () => sql("UPDATE templates SET subject = 'Hi {{ oops' WHERE id = ?", templateId), () => sql("UPDATE templates SET subject = 'Hello' WHERE id = ?", templateId), /malformed.*subject/i],
      ["links_ok", () => sql("UPDATE templates SET link_check_json = NULL WHERE id = ?", templateId), async () => void (await post(`/api/templates/${templateId}/link-check`)), /link check/],
      ["test_send_ok", () => sql("UPDATE templates SET last_test_ok_version = NULL WHERE id = ?", templateId), () => sql("UPDATE templates SET last_test_ok_version = 1 WHERE id = ?", templateId), /test/],
      ["test_send_ok", () => sql("UPDATE campaigns SET template_version = 0 WHERE id = ?", id), () => sql("UPDATE campaigns SET template_version = 1 WHERE id = ?", id), /changed after this campaign was created/],
      ["schedule_valid", () => sql("UPDATE campaigns SET schedule_json = ? WHERE id = ?", JSON.stringify({ ...ALL_DAY, dailyCap: 6000 }), id), () => sql("UPDATE campaigns SET schedule_json = ? WHERE id = ?", JSON.stringify(ALL_DAY), id), /one-click unsubscribe/],
      ["schedule_valid", () => sql("UPDATE campaigns SET schedule_json = 'nope' WHERE id = ?", id), () => sql("UPDATE campaigns SET schedule_json = ? WHERE id = ?", JSON.stringify(ALL_DAY), id), /schedule/i],
      ["schedule_valid", () => sql("UPDATE campaigns SET schedule_json = ? WHERE id = ?", JSON.stringify({ ...ALL_DAY, sendDays: [] }), id), () => sql("UPDATE campaigns SET schedule_json = ? WHERE id = ?", JSON.stringify(ALL_DAY), id), /at least one send day/],
    ];
    for (const [key, breakIt, restore, message] of cases) {
      await breakIt();
      const result = await gates(id);
      const failing = result.gates.filter((g: any) => !g.ok);
      expect(result.ok, key).toBe(false);
      expect(failing.map((g: any) => g.key), key).toEqual([key]);
      expect(failing[0].message, key).toMatch(message);
      await restore();
      expect((await gates(id)).ok, `${key} restored`).toBe(true);
    }
  });

  it("reports broken links and the template having changed since the link check", async () => {
    await setup();
    const { campaign, templateId } = await readyCampaign();
    const check = h.db.prepare("SELECT link_check_json FROM templates WHERE id = ?").get(templateId) as { link_check_json: string };
    const broken = JSON.parse(check.link_check_json);
    broken.links[0] = { ...broken.links[0], ok: false, status: 404, error: "HTTP 404" };
    h.db.prepare("UPDATE templates SET link_check_json = ? WHERE id = ?").run(JSON.stringify(broken), templateId);
    expect((await gates(campaign.id)).gates.find((g: any) => g.key === "links_ok").message).toMatch(/1 link.*fix or acknowledge/);

    h.db.prepare("UPDATE templates SET link_check_json = ? WHERE id = ?").run(JSON.stringify({ ...broken, version: 0 }), templateId);
    expect((await gates(campaign.id)).gates.find((g: any) => g.key === "links_ok").message).toMatch(/changed since the last link check/);
  });

  it("accepts a daily cap above 5,000 with an https public unsubscribe URL", async () => {
    await setup();
    await configureSender(h, smtp.port, { publicBaseUrl: "https://unsub.mama.example" });
    h.health.set("smtp", ok("Connected"));
    const { campaign } = await readyCampaign(CONTACTS, { ...ALL_DAY, dailyCap: 6000 });
    expect((await gates(campaign.id)).ok).toBe(true);
  });
});

describe("start, pause, resume, stop", () => {
  it("refuses to start when setup is incomplete", async () => {
    await setup();
    const { campaign } = await readyCampaign();
    h.db.prepare("DELETE FROM settings WHERE key = ?").run("setup_completed_at");
    const res = await post(`/api/campaigns/${campaign.id}/start`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("setup_incomplete");
    expect(status(campaign.id)).toBe("draft");
  });

  it("refuses to start with failing gates", async () => {
    await setup();
    const { campaign } = await readyCampaign();
    h.health.reset("smtp");
    const res = await post(`/api/campaigns/${campaign.id}/start`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("gates_failed");
    expect(res.json().error.details.find((g: any) => g.key === "smtp_verified")).toMatchObject({ ok: false });
    expect(status(campaign.id)).toBe("draft");
  });

  it("starts, sends every contact through the fake SMTP server, streams events and completes", async () => {
    await setup();
    const { campaign } = await readyCampaign();
    const res = await post(`/api/campaigns/${campaign.id}/start`);
    expect(res.statusCode).toBe(200);
    expect(["running", "completed"]).toContain(res.json().status);
    await waitFor(() => status(campaign.id) === "completed");

    const view = (await get(`/api/campaigns/${campaign.id}`)).json();
    expect(view.counts).toMatchObject({ sent: 3, pending: 0, total: 3 });
    expect(view.finishedAt).toEqual(expect.any(String));
    expect(smtp.received.map((m) => m.to[0]).sort()).toEqual(CONTACTS.map((c) => c.email));
    expect(smtp.received.every((m) => /^List-Unsubscribe: <mailto:unsub@mama\.example/m.test(m.raw.replace(/\r?\n[ \t]+/g, " ")))).toBe(true);
    expect(smtp.received.some((m) => TEST_INBOXES.includes(m.to[0]))).toBe(false);

    const workerEvents = h.published.filter((e) => e.name === "worker").map((e) => e.data);
    expect(workerEvents.filter((e) => e.type === "sent")).toHaveLength(3);
    const snapshots = h.published.filter((e) => e.name === "status").map((e) => e.data);
    expect(snapshots.at(-1).campaign).toMatchObject({ id: campaign.id, status: "completed" });
  });

  it("refuses to start a second campaign while another is held", async () => {
    await setup(heldClock);
    const first = (await readyCampaign()).campaign;
    const listId = seedList(h.db, [{ email: "dee@x.example" }]).listId;
    const second = (await post("/api/campaigns", { listId, templateId: first.templateId, schedule: ALL_DAY })).json();
    expect((await post(`/api/campaigns/${first.id}/start`)).statusCode).toBe(200);
    const res = await post(`/api/campaigns/${second.id}/start`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: "conflict", message: `Campaign ${first.id} is already active; stop it first` });
  });

  it("pauses, resumes and stops a running campaign", async () => {
    await setup(heldClock);
    const { campaign } = await readyCampaign();
    const id = campaign.id;
    expect((await post(`/api/campaigns/${id}/pause`)).json().error.code).toBe("invalid_state");
    expect((await post(`/api/campaigns/${id}/resume`)).json().error.code).toBe("invalid_state");

    expect((await post(`/api/campaigns/${id}/start`)).statusCode).toBe(200);
    await waitFor(() => smtp.received.length === 1);
    const started = await post(`/api/campaigns/${id}/start`);
    expect(started.statusCode).toBe(409);
    expect(started.json().error.code).toBe("invalid_state");

    const paused = await post(`/api/campaigns/${id}/pause`);
    expect(paused.statusCode).toBe(200);
    expect(paused.json()).toMatchObject({ status: "paused", pauseReason: "user" });

    h.health.reset("smtp");
    const blocked = await post(`/api/campaigns/${id}/resume`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("gates_failed");
    h.health.set("smtp", ok("Connected"));

    const resumed = await post(`/api/campaigns/${id}/resume`);
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({ status: "running", pauseReason: null });

    const stopped = await post(`/api/campaigns/${id}/stop`);
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json()).toMatchObject({ status: "stopped", finishedAt: expect.any(String) });
    expect((await post(`/api/campaigns/${id}/stop`)).json().status).toBe("stopped");
    const restart = await post(`/api/campaigns/${id}/start`);
    expect(restart.statusCode).toBe(409);
  });

  it("stops a draft without involving the worker", async () => {
    await setup();
    const { campaign } = await readyCampaign();
    const res = await post(`/api/campaigns/${campaign.id}/stop`);
    expect(res.json()).toMatchObject({ status: "stopped", finishedAt: expect.any(String) });
    expect(h.worker.getActivity().campaignId).toBeNull();
  });
});

describe("uncertain sends, requeue and events", () => {
  it("lists uncertain sends with paging and requeues some or all of them", async () => {
    await setup();
    const { campaign, contactIds } = await readyCampaign();
    const id = campaign.id;
    h.db
      .prepare("UPDATE sends SET state = 'uncertain', last_error = 'no reply', updated_at = '2026-10-26T09:00:00.000Z' WHERE campaign_id = ?")
      .run(id);
    const page = (await get(`/api/campaigns/${id}/uncertain?limit=2&offset=0`)).json();
    expect(page.total).toBe(3);
    expect(page.rows).toEqual([
      { contactId: contactIds[0], email: "ann@x.example", lastError: "no reply", updatedAt: "2026-10-26T09:00:00.000Z" },
      { contactId: contactIds[1], email: "bob@x.example", lastError: "no reply", updatedAt: "2026-10-26T09:00:00.000Z" },
    ]);
    expect((await get(`/api/campaigns/${id}/uncertain?limit=2&offset=2`)).json().rows.map((r: any) => r.contactId)).toEqual([contactIds[2]]);

    expect((await post(`/api/campaigns/${id}/requeue`, { contactIds: [contactIds[1]] })).json()).toEqual({ requeued: 1 });
    expect((await post(`/api/campaigns/${id}/requeue`, {})).json()).toEqual({ requeued: 2 });
    expect((await post(`/api/campaigns/${id}/requeue`)).json()).toEqual({ requeued: 0 });
    expect((await get(`/api/campaigns/${id}`)).json().counts).toMatchObject({ pending: 3, uncertain: 0 });
    const requeueEvents = (await get(`/api/campaigns/${id}/events?type=requeue`)).json().rows;
    expect(requeueEvents.map((e: any) => e.message)).toEqual(["Requeued 2 uncertain sends", "Requeued 1 uncertain send"]);
    expect((await get("/api/campaigns/999/uncertain")).statusCode).toBe(404);
  });

  it("pages events newest first with beforeId and filters by type", async () => {
    await setup();
    const { campaign } = await readyCampaign();
    const insert = h.db.prepare("INSERT INTO events (campaign_id, type, message, created_at) VALUES (?, ?, ?, ?)");
    const ids = ["sent", "failed", "sent", "status", "sent"].map((type, i) =>
      Number(insert.run(campaign.id, type, `m${i}`, `2026-10-26T10:00:0${i}.000Z`).lastInsertRowid),
    );
    insert.run(campaign.id + 100, "sent", "other campaign", "2026-10-26T10:00:09.000Z");

    const first = (await get(`/api/campaigns/${campaign.id}/events?limit=2`)).json().rows;
    expect(first).toEqual([
      { id: ids[4], type: "sent", message: "m4", createdAt: "2026-10-26T10:00:04.000Z" },
      { id: ids[3], type: "status", message: "m3", createdAt: "2026-10-26T10:00:03.000Z" },
    ]);
    const next = (await get(`/api/campaigns/${campaign.id}/events?limit=2&beforeId=${ids[3]}`)).json().rows;
    expect(next.map((e: any) => e.id)).toEqual([ids[2], ids[1]]);
    const sent = (await get(`/api/campaigns/${campaign.id}/events?type=sent`)).json().rows;
    expect(sent.map((e: any) => e.message)).toEqual(["m4", "m2", "m0"]);
    expect((await get(`/api/campaigns/${campaign.id}/events?limit=501`)).statusCode).toBe(400);
  });
});

describe("schedule updates and deletion", () => {
  it("updates the schedule of a draft or paused campaign only", async () => {
    await setup(heldClock);
    const { campaign } = await readyCampaign();
    const id = campaign.id;
    const updated = await put(`/api/campaigns/${id}/schedule`, { schedule: { ...ALL_DAY, dailyCap: 100 } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().schedule.dailyCap).toBe(100);
    expect((await put(`/api/campaigns/${id}/schedule`, { schedule: { ...ALL_DAY, delaySeconds: 0 } })).statusCode).toBe(400);

    await post(`/api/campaigns/${id}/start`);
    const running = await put(`/api/campaigns/${id}/schedule`, { schedule: ALL_DAY });
    expect(running.statusCode).toBe(409);
    expect(running.json().error.code).toBe("invalid_state");

    await post(`/api/campaigns/${id}/pause`);
    expect((await put(`/api/campaigns/${id}/schedule`, { schedule: { ...ALL_DAY, dailyCap: 50 } })).json().schedule.dailyCap).toBe(50);
  });

  it("deletes draft, completed and stopped campaigns with their rows, but not active or paused ones", async () => {
    await setup(heldClock);
    const { campaign } = await readyCampaign();
    const id = campaign.id;
    await post(`/api/campaigns/${id}/start`);
    const active = await del(`/api/campaigns/${id}`);
    expect(active.statusCode).toBe(409);
    expect(active.json().error.code).toBe("invalid_state");
    await post(`/api/campaigns/${id}/pause`);
    expect((await del(`/api/campaigns/${id}`)).statusCode).toBe(409);
    await post(`/api/campaigns/${id}/stop`);
    expect((await del(`/api/campaigns/${id}`)).statusCode).toBe(204);
    expect((await get(`/api/campaigns/${id}`)).statusCode).toBe(404);
    const count = (table: string) => (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE campaign_id = ?`).get(id) as { n: number }).n;
    expect([count("sends"), count("events"), count("campaign_days")]).toEqual([0, 0, 0]);

    const draft = (await readyCampaign()).campaign;
    expect((await del(`/api/campaigns/${draft.id}`)).statusCode).toBe(204);
    expect((await del(`/api/campaigns/${draft.id}`)).statusCode).toBe(404);
  });
});

describe("POST /api/estimate", () => {
  it("estimates a schedule and validates it", async () => {
    await setup();
    const res = await post("/api/estimate", { remaining: 120, schedule: { ...ALL_DAY, warmup: true } });
    expect(res.statusCode).toBe(200);
    const estimate = res.json();
    expect(estimate.perDay.reduce((n: number, d: any) => n + d.count, 0)).toBe(120);
    expect(estimate.completionDate).toBe(estimate.perDay.at(-1).date);
    expect((await post("/api/estimate", { remaining: 0, schedule: ALL_DAY })).json()).toEqual({ perDay: [], completionDate: null, totalDays: 0 });
    const bad = await post("/api/estimate", { remaining: 10, schedule: { ...ALL_DAY, timezone: "Mars/Base" } });
    expect(bad.statusCode).toBe(400);
    expect((await post("/api/estimate", { remaining: -1, schedule: ALL_DAY })).statusCode).toBe(400);
  });
});
