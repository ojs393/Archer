import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../server/db/index.ts";
import { addSuppression } from "../../server/db/suppression.ts";
import type { Schedule } from "../../server/domain/schedule.ts";
import { signToken } from "../../server/domain/unsubscribe.ts";
import { SendWorker, type SenderConfig, type WorkerDeps, type WorkerEvent } from "../../server/send/worker.ts";
import { startFakeSmtp, type FakeSmtp } from "../fakeSmtp.ts";

const SECRET = "unsub-secret-0123456789-0123456789-abcdef";
const START = Date.parse("2026-10-26T10:00:00Z");

let dir: string;
let db: DatabaseSync;
let smtp: FakeSmtp;
let nowMs: number;
let workers: SendWorker[];
let events: WorkerEvent[];
let savedEnv: string | undefined;

beforeAll(() => {
  savedEnv = process.env.ARCHER_TEST_SMTP;
  process.env.ARCHER_TEST_SMTP = "1";
});

afterAll(() => {
  if (savedEnv === undefined) delete process.env.ARCHER_TEST_SMTP;
  else process.env.ARCHER_TEST_SMTP = savedEnv;
});

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-worker-"));
  db = openDb(path.join(dir, "app.db"));
  smtp = await startFakeSmtp();
  nowMs = START;
  workers = [];
  events = [];
});

afterEach(async () => {
  for (const w of workers) await w.shutdown(500);
  await smtp.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const now = () => new Date(nowMs);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const advancingSleep = async (ms: number) => {
  nowMs += ms;
  await tick();
};
const blockingSleep = (_ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

function sender(overrides: Partial<SenderConfig["smtp"]> = {}): SenderConfig {
  return {
    smtp: {
      host: "127.0.0.1",
      port: smtp.port,
      secure: false,
      user: "test",
      pass: "test",
      connectionTimeoutMs: 2000,
      greetingTimeoutMs: 2000,
      socketTimeoutMs: 5000,
      ...overrides,
    },
    fromName: "Mama Direct",
    fromEmail: "hello@mama.example",
    replyTo: "reply@mama.example",
    postalAddress: "PO Box 1, Springfield",
    unsubMailbox: "unsub@mama.example",
    publicBaseUrl: null,
    unsubSecret: SECRET,
  };
}

function makeWorker(extra: Partial<WorkerDeps> = {}): SendWorker {
  const worker = new SendWorker({
    db,
    getSenderConfig: () => sender(),
    now,
    sleep: advancingSleep,
    random: () => 0.5,
    probeNetwork: async () => true,
    retryDelaysMs: [1, 1, 1, 1, 1],
    sendTimeoutMs: 3000,
    networkProbeIntervalMs: 10,
    ...extra,
  });
  worker.on("event", (e: WorkerEvent) => events.push(e));
  workers.push(worker);
  return worker;
}

const ALL_DAY: Schedule = {
  timezone: "UTC",
  sendDays: [0, 1, 2, 3, 4, 5, 6],
  startTime: "00:00",
  endTime: "23:59",
  dailyCap: 2000,
  warmup: false,
  delaySeconds: 1,
};

interface SeedContact {
  email: string;
  fields?: Record<string, string>;
}

function seed(
  contacts: SeedContact[],
  opts: { schedule?: Partial<Schedule>; status?: string } = {},
): { campaignId: number; contactIds: number[] } {
  const listId = Number(
    db
      .prepare("INSERT INTO lists (name, source_label, consent_text, consent_at, status) VALUES ('L', 'src', 'ok', '2026-10-01', 'ready')")
      .run().lastInsertRowid,
  );
  const insertContact = db.prepare("INSERT INTO contacts (list_id, email, domain, fields_json) VALUES (?, ?, ?, ?)");
  const contactIds = contacts.map((c) =>
    Number(insertContact.run(listId, c.email, c.email.split("@")[1], JSON.stringify(c.fields ?? {})).lastInsertRowid),
  );
  const templateId = Number(
    db
      .prepare("INSERT INTO templates (name, version, subject, html, text, variable_map_json) VALUES ('T', 1, ?, ?, NULL, '{}')")
      .run("Hello {{first_name | there}}", "<html><body><p>Hi {{first_name | there}},</p><p>Fresh news.</p></body></html>")
      .lastInsertRowid,
  );
  const campaignId = Number(
    db
      .prepare("INSERT INTO campaigns (list_id, template_id, template_version, status, schedule_json) VALUES (?, ?, 1, ?, ?)")
      .run(listId, templateId, opts.status ?? "draft", JSON.stringify({ ...ALL_DAY, ...opts.schedule })).lastInsertRowid,
  );
  const insertSend = db.prepare("INSERT INTO sends (campaign_id, contact_id) VALUES (?, ?)");
  for (const id of contactIds) insertSend.run(campaignId, id);
  return { campaignId, contactIds };
}

function people(n: number, prefix = "person"): SeedContact[] {
  return Array.from({ length: n }, (_, i) => ({ email: `${prefix}${String(i + 1).padStart(3, "0")}@example.org` }));
}

interface SendRow {
  contact_id: number;
  email: string;
  state: string;
  attempts: number;
  last_error: string | null;
  message_id: string | null;
  smtp_response: string | null;
}

function sends(campaignId: number): SendRow[] {
  return (
    db
      .prepare(
        `SELECT s.contact_id, c.email, s.state, s.attempts, s.last_error, s.message_id, s.smtp_response
         FROM sends s JOIN contacts c ON c.id = s.contact_id WHERE s.campaign_id = ? ORDER BY s.contact_id`,
      )
      .all(campaignId) as unknown as SendRow[]
  ).map((r) => ({ ...r }));
}

function campaign(campaignId: number): { status: string; pause_reason: string | null; started_at: string | null; finished_at: string | null } {
  return {
    ...(db.prepare("SELECT status, pause_reason, started_at, finished_at FROM campaigns WHERE id = ?").get(campaignId) as {
      status: string;
      pause_reason: string | null;
      started_at: string | null;
      finished_at: string | null;
    }),
  };
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function waitForStatus(campaignId: number, status: string): Promise<void> {
  await waitFor(() => campaign(campaignId).status === status, `status ${status} (now ${campaign(campaignId).status})`);
}

function receivedTo(): string[] {
  return smtp.received.flatMap((m) => m.to);
}

function statusMessages(): string[] {
  return events.filter((e) => e.type === "status").map((e) => e.message);
}

function decodeRaw(raw: string): string {
  return raw
    .replace(/\r\n[ \t]+/g, " ")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

describe("SendWorker — happy path", () => {
  it("sends every contact once, in order, and completes", async () => {
    const { campaignId } = seed(people(5));
    const worker = makeWorker();
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    expect(receivedTo()).toEqual(people(5).map((p) => p.email));
    const rows = sends(campaignId);
    expect(rows.map((r) => [r.state, r.attempts])).toEqual(Array(5).fill(["sent", 1]));
    for (const r of rows) {
      expect(r.message_id).toMatch(/@/);
      expect(r.smtp_response).toMatch(/^250 /);
    }
    expect(campaign(campaignId).started_at).not.toBeNull();
    expect(campaign(campaignId).finished_at).not.toBeNull();
    expect(db.prepare("SELECT day, sent FROM campaign_days WHERE campaign_id = ?").all(campaignId).map((r) => ({ ...r }))).toEqual([
      { day: "2026-10-26", sent: 5 },
    ]);
  });

  it("records every WorkerEvent in the events table and emits it", async () => {
    const { campaignId } = seed(people(3));
    const worker = makeWorker();
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    const sent = events.filter((e) => e.type === "sent");
    expect(sent.map((e) => e.email)).toEqual(people(3).map((p) => p.email));
    for (const e of events) {
      expect(e.campaignId).toBe(campaignId);
      expect(Number.isNaN(Date.parse(e.at))).toBe(false);
    }
    expect(statusMessages()[0]).toMatch(/running/);
    expect(statusMessages().at(-1)).toMatch(/completed/);
    const stored = db
      .prepare("SELECT type, message, created_at FROM events WHERE campaign_id = ? ORDER BY id")
      .all(campaignId)
      .map((r) => ({ ...r }));
    expect(stored).toEqual(events.map((e) => ({ type: e.type, message: e.message, created_at: e.at })));
  });

  it("delivers a personalized, compliant message", async () => {
    const email = "jane.doe@example.org";
    const { campaignId } = seed([{ email, fields: { first_name: "Jane" } }]);
    const worker = makeWorker();
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    expect(smtp.received).toHaveLength(1);
    expect(smtp.received[0].from).toBe("hello@mama.example");
    const raw = decodeRaw(smtp.received[0].raw);
    const token = signToken(email, SECRET);
    expect(raw).toMatch(/^From: Mama Direct <hello@mama\.example>$/m);
    expect(raw).toMatch(/^To: jane\.doe@example\.org$/m);
    expect(raw).toMatch(/^Reply-To: reply@mama\.example$/m);
    expect(raw).toMatch(/^Subject: Hello Jane$/m);
    expect(raw).toContain(`List-Unsubscribe: <mailto:unsub@mama.example?subject=unsubscribe%20${token}>`);
    expect(raw).toContain("Hi Jane,");
    expect(raw).toContain("PO Box 1, Springfield");
    expect(raw).toContain(`Unsubscribe: mailto:unsub@mama.example?subject=unsubscribe%20${token}`);
    expect(raw).toContain(`href="mailto:unsub@mama.example?subject=unsubscribe%20${token}"`);
  });
});

describe("SendWorker — SMTP failures", () => {
  it("retries a 451 and ends sent with several attempts", async () => {
    const { campaignId } = seed(people(2));
    const target = people(2)[0].email;
    let deferrals = 0;
    smtp.setRcptBehavior((to) => (to === target && deferrals++ < 2 ? { code: 451, message: "4.7.1 Try again later" } : "accept"));
    const worker = makeWorker();
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    const rows = sends(campaignId);
    expect(rows[0]).toMatchObject({ state: "sent", attempts: 3 });
    expect(rows[1]).toMatchObject({ state: "sent", attempts: 1 });
    expect(events.filter((e) => e.type === "retry")).toHaveLength(2);
    expect(receivedTo()).toEqual(people(2).map((p) => p.email));
  });

  it("fails after maxAttempts transient errors", async () => {
    const { campaignId } = seed(people(1));
    smtp.setRcptBehavior(() => ({ code: 451, message: "4.7.1 Try again later" }));
    const worker = makeWorker({ maxAttempts: 3 });
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    expect(sends(campaignId)[0]).toMatchObject({ state: "failed", attempts: 3 });
    expect(events.filter((e) => e.type === "retry")).toHaveLength(2);
    expect(events.filter((e) => e.type === "failed")).toHaveLength(1);
  });

  it("fails and suppresses a 550 5.1.1", async () => {
    const { campaignId } = seed(people(3));
    const bad = people(3)[1].email;
    smtp.setRcptBehavior((to) => (to === bad ? { code: 550, message: "5.1.1 User unknown" } : "accept"));
    const worker = makeWorker();
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    const rows = sends(campaignId);
    expect(rows.map((r) => r.state)).toEqual(["sent", "failed", "sent"]);
    expect(rows[1].last_error).toMatch(/550/);
    expect(db.prepare("SELECT reason FROM suppression WHERE email = ?").get(bad)).toMatchObject({ reason: "hard_bounce" });
    expect(events.filter((e) => e.type === "suppressed").map((e) => e.email)).toEqual([bad]);
  });

  it("pauses with auth_failed on 535 and leaves rows pending", async () => {
    const { campaignId } = seed(people(3));
    const worker = makeWorker({ getSenderConfig: () => sender({ pass: "wrong" }) });
    worker.start(campaignId);
    await waitForStatus(campaignId, "paused");

    expect(campaign(campaignId).pause_reason).toBe("auth_failed");
    expect(sends(campaignId).map((r) => [r.state, r.attempts])).toEqual(Array(3).fill(["pending", 0]));
    expect(smtp.received).toHaveLength(0);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("marks a send that exceeds the hard cap uncertain and carries on", async () => {
    const { campaignId } = seed(people(3));
    smtp.setDataBehavior((n) => (n === 2 ? "hang" : "accept"));
    const worker = makeWorker({ sendTimeoutMs: 300 });
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    expect(sends(campaignId).map((r) => r.state)).toEqual(["sent", "uncertain", "sent"]);
    expect(receivedTo()).toEqual([people(3)[0].email, people(3)[2].email]);
    expect(events.filter((e) => e.type === "uncertain").map((e) => e.email)).toEqual([people(3)[1].email]);
  });

  it("marks a DATA-stage drop uncertain and never retries it", async () => {
    const { campaignId } = seed(people(3));
    const rcpts: string[] = [];
    smtp.setRcptBehavior((to) => {
      rcpts.push(to);
      return "accept";
    });
    smtp.setDataBehavior((n) => (n === 1 ? "drop" : "accept"));
    const worker = makeWorker();
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    expect(sends(campaignId).map((r) => [r.state, r.attempts])).toEqual([
      ["uncertain", 1],
      ["sent", 1],
      ["sent", 1],
    ]);
    expect(rcpts.filter((to) => to === people(3)[0].email)).toHaveLength(1);
  });

  it("waits for the network after a connection error, then resumes", async () => {
    const { campaignId } = seed(people(2));
    let drops = 0;
    smtp.setMailFromBehavior(() => (drops++ === 0 ? "drop" : "accept"));
    const probes: boolean[] = [false, false, true];
    let probeCalls = 0;
    const worker = makeWorker({ probeNetwork: async () => probes[Math.min(probeCalls++, probes.length - 1)] });
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    expect(probeCalls).toBe(3);
    const statuses = statusMessages();
    const waiting = statuses.findIndex((m) => /waiting_network/.test(m));
    expect(waiting).toBeGreaterThan(0);
    expect(statuses.slice(waiting + 1).some((m) => /running/.test(m))).toBe(true);
    expect(sends(campaignId).map((r) => [r.state, r.attempts])).toEqual([
      ["sent", 2],
      ["sent", 1],
    ]);
    expect(receivedTo()).toEqual(people(2).map((p) => p.email));
  });
});

describe("SendWorker — safety stop", () => {
  it("stops when rejections exceed 5% of the last outcomes (min sample 50)", async () => {
    const list = people(60);
    const { campaignId } = seed(list);
    const bad = new Set(list.slice(0, 4).map((p) => p.email));
    smtp.setRcptBehavior((to) => (bad.has(to) ? { code: 550, message: "5.1.1 User unknown" } : "accept"));
    const worker = makeWorker();
    worker.start(campaignId);
    await waitForStatus(campaignId, "safety_stop");

    expect(campaign(campaignId).pause_reason).toBe("rejection_rate");
    const states = sends(campaignId).map((r) => r.state);
    expect(states.filter((s) => s === "failed")).toHaveLength(4);
    expect(states.filter((s) => s === "sent")).toHaveLength(46);
    expect(states.filter((s) => s === "pending")).toHaveLength(10);
    expect(smtp.received).toHaveLength(46);
  });

  it("starts a fresh sample after resuming from a safety stop", async () => {
    const list = people(60);
    const { campaignId } = seed(list);
    const bad = new Set(list.slice(0, 4).map((p) => p.email));
    smtp.setRcptBehavior((to) => (bad.has(to) ? { code: 550, message: "5.1.1 User unknown" } : "accept"));
    const worker = makeWorker();
    worker.start(campaignId);
    await waitForStatus(campaignId, "safety_stop");
    worker.resume();
    await waitForStatus(campaignId, "completed");

    expect(smtp.received).toHaveLength(56);
    expect(new Set(receivedTo()).size).toBe(56);
  });
});

describe("SendWorker — schedule", () => {
  it("waits outside the send window without sending", async () => {
    nowMs = Date.parse("2026-10-26T15:00:00Z");
    const { campaignId } = seed(people(2), { schedule: { startTime: "09:00", endTime: "10:00" } });
    const worker = makeWorker({ sleep: blockingSleep });
    worker.start(campaignId);
    await waitForStatus(campaignId, "waiting_window");

    expect(smtp.received).toHaveLength(0);
    expect(sends(campaignId).map((r) => [r.state, r.attempts])).toEqual(Array(2).fill(["pending", 0]));
    expect(worker.getActivity()).toMatchObject({
      campaignId,
      status: "waiting_window",
      expectedWakeAt: Date.parse("2026-10-27T09:00:00Z"),
      delaySeconds: 1,
    });
  });

  it("sends exactly the warm-up quota on day 1, then continues the next day", async () => {
    nowMs = Date.parse("2026-10-26T00:00:00Z");
    const { campaignId } = seed(people(60), { schedule: { warmup: true } });
    const worker = makeWorker();
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    const days = db.prepare("SELECT day, sent FROM campaign_days WHERE campaign_id = ? ORDER BY day").all(campaignId);
    expect(days.map((r) => ({ ...r }))).toEqual([
      { day: "2026-10-26", sent: 50 },
      { day: "2026-10-27", sent: 10 },
    ]);
    expect(statusMessages().some((m) => /waiting_window/.test(m))).toBe(true);
    expect(smtp.received).toHaveLength(60);
  });

  it("pauses with no_send_window when the stored schedule can never open", async () => {
    nowMs = Date.parse("2026-10-26T15:00:00Z");
    const { campaignId } = seed(people(1), { schedule: { startTime: "09:00", endTime: "10:00" } });
    const worker = makeWorker({ sleep: blockingSleep });
    worker.start(campaignId);
    await waitForStatus(campaignId, "waiting_window");
    db.prepare("UPDATE campaigns SET schedule_json = ? WHERE id = ?").run(JSON.stringify({ ...ALL_DAY, sendDays: [] }), campaignId);
    worker.restartLoop("schedule edited");
    await waitForStatus(campaignId, "paused");

    expect(campaign(campaignId).pause_reason).toBe("no_send_window");
    expect(smtp.received).toHaveLength(0);
  });
});

describe("SendWorker — recipients and templates", () => {
  it("skips a contact suppressed after the campaign was created", async () => {
    const list = people(3);
    const { campaignId } = seed(list);
    addSuppression(db, list[1].email, "unsubscribe");
    const worker = makeWorker();
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    expect(sends(campaignId).map((r) => [r.state, r.attempts])).toEqual([
      ["sent", 1],
      ["skipped_suppressed", 0],
      ["sent", 1],
    ]);
    expect(receivedTo()).toEqual([list[0].email, list[2].email]);
    expect(events.filter((e) => e.type === "skipped").map((e) => e.email)).toEqual([list[1].email]);
  });

  it("pauses with template_changed when the template version moved on", async () => {
    const { campaignId } = seed(people(2));
    db.prepare("UPDATE templates SET version = 2").run();
    const worker = makeWorker();
    worker.start(campaignId);
    await waitForStatus(campaignId, "paused");

    expect(campaign(campaignId).pause_reason).toBe("template_changed");
    expect(sends(campaignId).map((r) => [r.state, r.attempts])).toEqual(Array(2).fill(["pending", 0]));
    expect(smtp.received).toHaveLength(0);
  });

  it("pauses with template_error on a malformed template", async () => {
    const { campaignId } = seed(people(1));
    db.prepare("UPDATE templates SET html = '<p>Hi {{first_name</p>'").run();
    const worker = makeWorker();
    worker.start(campaignId);
    await waitForStatus(campaignId, "paused");

    expect(campaign(campaignId).pause_reason).toBe("template_error");
    expect(sends(campaignId)[0]).toMatchObject({ state: "pending", attempts: 0 });
  });

  it("fails only the row whose variable cannot be resolved", async () => {
    const { campaignId } = seed([{ email: "a@example.org", fields: { city: "Paris" } }, { email: "b@example.org" }]);
    db.prepare("UPDATE templates SET html = '<p>From {{city}}</p>'").run();
    const worker = makeWorker();
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    const rows = sends(campaignId);
    expect(rows.map((r) => r.state)).toEqual(["sent", "failed"]);
    expect(rows[1].last_error).toMatch(/city/);
    expect(receivedTo()).toEqual(["a@example.org"]);
  });
});

describe("SendWorker — recovery and control", () => {
  it("turns a row left in sending into uncertain on boot and never resends it", async () => {
    const list = people(4);
    const { campaignId, contactIds } = seed(list, { status: "running" });
    db.prepare("UPDATE sends SET state = 'sending', attempts = 1 WHERE contact_id = ?").run(contactIds[1]);
    const worker = makeWorker();
    expect(worker.recoverOnBoot()).toEqual({ uncertain: 1, resumeCampaignId: campaignId });
    expect(events.filter((e) => e.type === "uncertain").map((e) => e.email)).toEqual([list[1].email]);
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    expect(sends(campaignId).map((r) => r.state)).toEqual(["sent", "uncertain", "sent", "sent"]);
    expect(receivedTo()).toEqual([list[0].email, list[2].email, list[3].email]);
  });

  it("returns no campaign to resume when none was active", () => {
    seed(people(1), { status: "paused" });
    expect(makeWorker().recoverOnBoot()).toEqual({ uncertain: 0, resumeCampaignId: null });
  });

  it("requeues uncertain rows only on request", async () => {
    const list = people(2);
    const { campaignId, contactIds } = seed(list, { status: "running" });
    db.prepare("UPDATE sends SET state = 'sending', attempts = 1").run();
    const worker = makeWorker();
    worker.recoverOnBoot();
    expect(worker.requeueUncertain(campaignId, [contactIds[0]])).toBe(1);
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    expect(sends(campaignId).map((r) => r.state)).toEqual(["sent", "uncertain"]);
    expect(worker.requeueUncertain(campaignId)).toBe(1);
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");
    expect(sends(campaignId).map((r) => r.state)).toEqual(["sent", "sent"]);
    expect(receivedTo()).toEqual(list.map((p) => p.email));
  });

  it("pauses after the in-flight send and resumes without duplicates", async () => {
    const list = people(4);
    const { campaignId } = seed(list);
    const worker = makeWorker();
    worker.on("event", (e: WorkerEvent) => {
      if (e.type === "sent" && e.email === list[0].email) worker.pause("user");
    });
    worker.start(campaignId);
    await waitForStatus(campaignId, "paused");
    await waitFor(() => worker.getActivity().inFlightSince === null, "in-flight to settle");
    expect(campaign(campaignId).pause_reason).toBe("user");
    expect(smtp.received).toHaveLength(1);

    worker.resume();
    await waitForStatus(campaignId, "completed");
    expect(campaign(campaignId).pause_reason).toBeNull();
    expect(receivedTo()).toEqual(list.map((p) => p.email));
  });

  it("stops after the in-flight send", async () => {
    const list = people(4);
    const { campaignId } = seed(list);
    const worker = makeWorker();
    worker.on("event", (e: WorkerEvent) => {
      if (e.type === "sent" && e.email === list[1].email) worker.stop();
    });
    worker.start(campaignId);
    await waitForStatus(campaignId, "stopped");
    await waitFor(() => worker.getActivity().inFlightSince === null, "in-flight to settle");
    expect(smtp.received).toHaveLength(2);
    expect(sends(campaignId).map((r) => r.state)).toEqual(["sent", "sent", "pending", "pending"]);
  });

  it("refuses to start a second campaign, a missing one, or an invalid schedule", async () => {
    const first = seed(people(1)).campaignId;
    const second = seed(people(1, "other")).campaignId;
    const broken = seed(people(1, "broken"), { schedule: { delaySeconds: 0 } }).campaignId;
    const worker = makeWorker({ sleep: blockingSleep });
    expect(() => worker.start(broken)).toThrow(/Delay/);
    expect(() => worker.start(9999)).toThrow(/not found/i);
    worker.start(first);
    expect(() => worker.start(second)).toThrow(/active/i);
  });

  it("survives a transient unexpected exception inside the loop", async () => {
    const { campaignId } = seed(people(2));
    const good = (db.prepare("SELECT schedule_json FROM campaigns WHERE id = ?").get(campaignId) as { schedule_json: string })
      .schedule_json;
    const naps: number[] = [];
    const worker = makeWorker({
      sleep: async (ms) => {
        naps.push(ms);
        if (ms === 5000) db.prepare("UPDATE campaigns SET schedule_json = ? WHERE id = ?").run(good, campaignId);
        await advancingSleep(ms);
      },
    });
    worker.once("event", () => db.prepare("UPDATE campaigns SET schedule_json = '{corrupt' WHERE id = ?").run(campaignId));
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    expect(events.filter((e) => e.type === "error" && /Unexpected error in send loop/.test(e.message))).toHaveLength(1);
    expect(naps).toContain(5000);
    expect(receivedTo()).toEqual(people(2).map((p) => p.email));
  });

  it("pauses with unexpected_error after 5 consecutive loop errors", async () => {
    const { campaignId } = seed(people(1));
    const naps: number[] = [];
    const worker = makeWorker({
      sleep: async (ms) => {
        naps.push(ms);
        await advancingSleep(ms);
      },
    });
    worker.once("event", () => db.prepare("UPDATE campaigns SET schedule_json = '{corrupt' WHERE id = ?").run(campaignId));
    worker.start(campaignId);
    await waitForStatus(campaignId, "paused");

    expect(campaign(campaignId).pause_reason).toBe("unexpected_error");
    expect(events.filter((e) => e.type === "error" && /Unexpected error in send loop/.test(e.message))).toHaveLength(5);
    expect(naps.filter((ms) => ms === 5000)).toHaveLength(4);
    expect(sends(campaignId)[0]).toMatchObject({ state: "pending", attempts: 0 });
    expect(smtp.received).toHaveLength(0);
  });

  it.each([
    ["a corrupt variable map", (): Partial<WorkerDeps> => {
      db.prepare("UPDATE templates SET variable_map_json = '{corrupt'").run();
      return {};
    }],
    ["createTransport throwing", (): Partial<WorkerDeps> => ({
      createTransport: () => {
        throw new Error("transport factory broke");
      },
    })],
    ["getSenderConfig throwing", (): Partial<WorkerDeps> => ({
      getSenderConfig: () => {
        throw new Error("settings unreadable");
      },
    })],
  ])("reverts the row and pauses with internal_error on %s before anything is sent", async (_label, setup) => {
    const { campaignId } = seed(people(2));
    const worker = makeWorker(setup());
    worker.start(campaignId);
    await waitForStatus(campaignId, "paused");

    expect(campaign(campaignId).pause_reason).toBe("internal_error");
    expect(sends(campaignId).map((r) => [r.state, r.attempts])).toEqual(Array(2).fill(["pending", 0]));
    expect(events.some((e) => e.type === "uncertain")).toBe(false);
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(smtp.received).toHaveLength(0);
  });

  it("selects a retry row with no next_attempt_at instead of idling", async () => {
    const { campaignId, contactIds } = seed(people(2));
    db.prepare("UPDATE sends SET state = 'retry', attempts = 1, next_attempt_at = NULL WHERE contact_id = ?").run(contactIds[0]);
    const worker = makeWorker();
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    expect(sends(campaignId).map((r) => [r.state, r.attempts])).toEqual([
      ["sent", 2],
      ["sent", 1],
    ]);
  });

  it.each(["postalAddress", "unsubMailbox", "fromEmail"] as const)(
    "pauses with compliance_config when %s is blank",
    async (field) => {
      const { campaignId } = seed(people(2));
      const worker = makeWorker({ getSenderConfig: () => ({ ...sender(), [field]: "  " }) });
      worker.start(campaignId);
      await waitForStatus(campaignId, "paused");

      expect(campaign(campaignId).pause_reason).toBe("compliance_config");
      expect(sends(campaignId).map((r) => [r.state, r.attempts])).toEqual(Array(2).fill(["pending", 0]));
      expect(smtp.received).toHaveLength(0);
    },
  );

  it("restartLoop marks the in-flight row uncertain and continues", async () => {
    const list = people(3);
    const { campaignId } = seed(list);
    smtp.setDataBehavior((n) => (n === 1 ? "hang" : "accept"));
    const worker = makeWorker({ sendTimeoutMs: 60_000 });
    worker.start(campaignId);
    await waitFor(() => worker.getActivity().inFlightSince !== null, "in-flight send");
    await new Promise((r) => setTimeout(r, 50));
    worker.restartLoop("stalled");
    await waitForStatus(campaignId, "completed");

    expect(sends(campaignId).map((r) => r.state)).toEqual(["uncertain", "sent", "sent"]);
    expect(receivedTo()).toEqual([list[1].email, list[2].email]);
  });

  it("shutdown aborts a stuck send as uncertain and keeps the campaign status", async () => {
    const { campaignId } = seed(people(2));
    smtp.setDataBehavior(() => "hang");
    const worker = makeWorker({ sendTimeoutMs: 60_000 });
    worker.start(campaignId);
    await waitFor(() => worker.getActivity().inFlightSince !== null, "in-flight send");
    await new Promise((r) => setTimeout(r, 50));
    await worker.shutdown(100);

    expect(campaign(campaignId).status).toBe("running");
    expect(sends(campaignId).map((r) => r.state)).toEqual(["uncertain", "pending"]);
    expect(worker.getActivity().inFlightSince).toBeNull();
  });
});

describe("SendWorker — user control always wins over the loop", () => {
  it("stays stopped when a pending network probe later succeeds", async () => {
    const { campaignId } = seed(people(2));
    let mailFroms = 0;
    smtp.setMailFromBehavior(() => (mailFroms++ === 0 ? "drop" : "accept"));
    let probeCalls = 0;
    let resolveProbe: (ok: boolean) => void = () => {};
    const worker = makeWorker({
      probeNetwork: () => {
        probeCalls += 1;
        if (probeCalls === 1) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
          resolveProbe = resolve;
        });
      },
    });
    worker.start(campaignId);
    await waitFor(() => probeCalls === 2, "second probe");
    expect(campaign(campaignId).status).toBe("waiting_network");
    worker.stop();
    resolveProbe(true);
    await new Promise((r) => setTimeout(r, 300));

    expect(campaign(campaignId).status).toBe("stopped");
    expect(campaign(campaignId).finished_at).not.toBeNull();
    expect(mailFroms).toBe(1);
    expect(smtp.received).toHaveLength(0);
  });

  it("keeps a pause made during an in-flight send when an auth error arrives afterwards", async () => {
    const { campaignId } = seed(people(2));
    let worker: SendWorker | undefined;
    smtp.setMailFromBehavior(() => {
      worker?.pause("user");
      return { code: 535, message: "5.7.8 Authentication required" };
    });
    worker = makeWorker();
    worker.start(campaignId);
    await waitFor(() => events.some((e) => e.type === "error"), "auth error event");
    await waitFor(() => worker.getActivity().inFlightSince === null, "in-flight to settle");

    expect(campaign(campaignId)).toMatchObject({ status: "paused", pause_reason: "user" });
    expect(sends(campaignId).map((r) => [r.state, r.attempts])).toEqual(Array(2).fill(["pending", 0]));
    expect(smtp.received).toHaveLength(0);
  });
});

describe("SendWorker — control after a reboot", () => {
  it("adopts a paused campaign so stop() works and another campaign can start", async () => {
    const paused = seed(people(1), { status: "paused" }).campaignId;
    db.prepare("UPDATE campaigns SET pause_reason = 'user' WHERE id = ?").run(paused);
    const other = seed(people(2, "other")).campaignId;
    const worker = makeWorker();
    expect(worker.recoverOnBoot()).toEqual({ uncertain: 0, resumeCampaignId: null });
    expect(worker.getActivity().campaignId).toBe(paused);
    expect(campaign(paused).status).toBe("paused");

    worker.stop();
    expect(campaign(paused).status).toBe("stopped");
    worker.start(other);
    await waitForStatus(other, "completed");
    expect(receivedTo()).toEqual(people(2, "other").map((p) => p.email));
  });

  it("adopts a safety-stopped campaign so resume() relaunches it", async () => {
    const { campaignId } = seed(people(2), { status: "safety_stop" });
    const worker = makeWorker();
    expect(worker.recoverOnBoot()).toEqual({ uncertain: 0, resumeCampaignId: null });
    expect(smtp.received).toHaveLength(0);

    worker.resume();
    await waitForStatus(campaignId, "completed");
    expect(receivedTo()).toEqual(people(2).map((p) => p.email));
  });
});
