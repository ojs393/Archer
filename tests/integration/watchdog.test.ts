import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../server/db/index.ts";
import type { Schedule } from "../../server/domain/schedule.ts";
import { Watchdog } from "../../server/send/watchdog.ts";
import { SendWorker, type SenderConfig, type WorkerDeps, type WorkerEvent } from "../../server/send/worker.ts";
import { startFakeSmtp, type FakeSmtp } from "../fakeSmtp.ts";

const START = Date.parse("2026-10-26T10:00:00Z");

let dir: string;
let db: DatabaseSync;
let smtp: FakeSmtp;
let nowMs: number;
let workers: SendWorker[];
let events: WorkerEvent[];
let savedEnv: string | undefined;

beforeAll(() => {
  savedEnv = process.env.MAMADIRECT_TEST_SMTP;
  process.env.MAMADIRECT_TEST_SMTP = "1";
});

afterAll(() => {
  if (savedEnv === undefined) delete process.env.MAMADIRECT_TEST_SMTP;
  else process.env.MAMADIRECT_TEST_SMTP = savedEnv;
});

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mamadirect-watchdog-"));
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
const advancingSleep = async (ms: number) => {
  nowMs += ms;
  await new Promise<void>((resolve) => setImmediate(resolve));
};
const blockingSleep = (_ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

function sender(): SenderConfig {
  return {
    smtp: {
      host: "127.0.0.1",
      port: smtp.port,
      secure: false,
      user: "test",
      pass: "test",
      connectionTimeoutMs: 2000,
      greetingTimeoutMs: 2000,
      socketTimeoutMs: 30_000,
    },
    fromName: "Mama Direct",
    fromEmail: "hello@mama.example",
    replyTo: null,
    postalAddress: "PO Box 1, Springfield",
    unsubMailbox: "unsub@mama.example",
    publicBaseUrl: null,
    unsubSecret: "unsub-secret-0123456789-0123456789-abcdef",
  };
}

function makeWorker(extra: Partial<WorkerDeps> = {}): SendWorker {
  const worker = new SendWorker({
    db,
    getSenderConfig: sender,
    now,
    sleep: advancingSleep,
    random: () => 0.5,
    probeNetwork: async () => true,
    retryDelaysMs: [1, 1, 1, 1, 1],
    sendTimeoutMs: 10_000,
    networkProbeIntervalMs: 10,
    ...extra,
  });
  worker.on("event", (e: WorkerEvent) => events.push(e));
  workers.push(worker);
  return worker;
}

function makeWatchdog(worker: SendWorker, logs: string[] = []): Watchdog {
  return new Watchdog(worker, { now: () => nowMs, sendTimeoutMs: 200, onLog: (m) => logs.push(m) });
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

function people(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `person${i + 1}@example.org`);
}

function seed(emails: string[], opts: { schedule?: Partial<Schedule>; status?: string } = {}): number {
  const listId = Number(
    db
      .prepare("INSERT INTO lists (name, source_label, consent_text, consent_at, status) VALUES ('L', 'src', 'ok', '2026-10-01', 'ready')")
      .run().lastInsertRowid,
  );
  const templateId = Number(
    db
      .prepare("INSERT INTO templates (name, version, subject, html, text, variable_map_json) VALUES ('T', 1, 'Hello', '<p>Hi there</p>', NULL, '{}')")
      .run().lastInsertRowid,
  );
  const campaignId = Number(
    db
      .prepare("INSERT INTO campaigns (list_id, template_id, template_version, status, schedule_json) VALUES (?, ?, 1, ?, ?)")
      .run(listId, templateId, opts.status ?? "draft", JSON.stringify({ ...ALL_DAY, ...opts.schedule })).lastInsertRowid,
  );
  const insertContact = db.prepare("INSERT INTO contacts (list_id, email, domain, fields_json) VALUES (?, ?, ?, '{}')");
  const insertSend = db.prepare("INSERT INTO sends (campaign_id, contact_id) VALUES (?, ?)");
  for (const email of emails) insertSend.run(campaignId, Number(insertContact.run(listId, email, email.split("@")[1]).lastInsertRowid));
  return campaignId;
}

function states(campaignId: number): string[] {
  return db
    .prepare("SELECT state FROM sends WHERE campaign_id = ? ORDER BY contact_id")
    .all(campaignId)
    .map((r) => (r as { state: string }).state);
}

function status(campaignId: number): string {
  return (db.prepare("SELECT status FROM campaigns WHERE id = ?").get(campaignId) as { status: string }).status;
}

function receivedTo(): string[] {
  return smtp.received.flatMap((m) => m.to);
}

function restarts(): string[] {
  return events.filter((e) => e.type === "error" && /Send loop restarted/.test(e.message)).map((e) => e.message);
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function waitForStatus(campaignId: number, want: string): Promise<void> {
  await waitFor(() => status(campaignId) === want, `status ${want} (now ${status(campaignId)})`);
}

describe("Watchdog + SendWorker", () => {
  it("recovers a hung send: the stuck row becomes uncertain and the rest are sent", async () => {
    const list = people(3);
    const campaignId = seed(list);
    smtp.setDataBehavior((n) => (n === 1 ? "hang" : "accept"));
    const worker = makeWorker();
    const logs: string[] = [];
    const dog = makeWatchdog(worker, logs);
    worker.start(campaignId);
    await waitFor(() => worker.getActivity().inFlightSince !== null, "in-flight send");
    await new Promise((r) => setTimeout(r, 50));

    dog.tick();
    expect(restarts()).toEqual([]);
    nowMs += 30_201;
    dog.tick();
    await waitForStatus(campaignId, "completed");

    expect(states(campaignId)).toEqual(["uncertain", "sent", "sent"]);
    expect(receivedTo()).toEqual(list.slice(1));
    expect(restarts()).toEqual(["Send loop restarted: watchdog: send_stalled"]);
    expect(logs.some((m) => /send_stalled/.test(m))).toBe(true);
  });

  it("relaunches a dead loop for an active campaign adopted after a reboot", async () => {
    const campaignId = seed(people(2), { status: "running" });
    const worker = makeWorker();
    worker.recoverOnBoot();
    expect(worker.getActivity()).toMatchObject({ campaignId, status: "running", loopRunning: false });

    makeWatchdog(worker).tick();
    expect(worker.getActivity().loopRunning).toBe(true);
    await waitForStatus(campaignId, "completed");

    expect(receivedTo()).toEqual(people(2));
    expect(restarts()).toEqual(["Send loop restarted: watchdog: loop_not_running"]);
    await waitFor(() => !worker.getActivity().loopRunning, "loop to exit");
  });

  it("wakes from a clock jump during a long window wait and sends once the window is open", async () => {
    nowMs = Date.parse("2026-10-26T15:00:00Z");
    const campaignId = seed(people(1), { schedule: { startTime: "09:00", endTime: "10:00" } });
    const worker = makeWorker({ sleep: (ms, signal) => (ms >= 3_600_000 ? blockingSleep(ms, signal) : advancingSleep(ms)) });
    const dog = makeWatchdog(worker);
    worker.start(campaignId);
    await waitForStatus(campaignId, "waiting_window");
    dog.tick();

    nowMs = Date.parse("2026-10-27T09:05:00Z");
    dog.tick();
    await waitForStatus(campaignId, "completed");

    expect(receivedTo()).toEqual(people(1));
    expect(restarts()).toEqual([]);
  });

  it("does not see a long network outage as a stall", async () => {
    const campaignId = seed(people(2));
    let mailFroms = 0;
    smtp.setMailFromBehavior(() => (mailFroms++ === 0 ? "drop" : "accept"));
    let probes = 0;
    const activity: ReturnType<SendWorker["getActivity"]>[] = [];
    const worker: SendWorker = makeWorker({
      networkProbeIntervalMs: 15_000,
      probeNetwork: async () => {
        probes += 1;
        activity.push(worker.getActivity());
        dog.tick();
        return probes > 40;
      },
    });
    const dog = makeWatchdog(worker);
    worker.start(campaignId);
    await waitForStatus(campaignId, "completed");

    expect(probes).toBe(41);
    expect(activity.slice(1).every((a) => a.status === "waiting_network" && a.inFlightSince === null)).toBe(true);
    expect(restarts()).toEqual([]);
    expect(receivedTo()).toEqual(people(2));
  });
});

describe("SendWorker — wake and loop activity", () => {
  it("reports loopRunning only while the loop is alive", async () => {
    const campaignId = seed(people(1));
    const worker = makeWorker({ sleep: blockingSleep });
    expect(worker.getActivity().loopRunning).toBe(false);
    worker.start(campaignId);
    expect(worker.getActivity().loopRunning).toBe(true);
    worker.pause("user");
    await waitFor(() => !worker.getActivity().loopRunning, "loop to exit");
    expect(status(campaignId)).toBe("paused");
  });

  it("wake() during a long window wait makes the loop re-evaluate immediately", async () => {
    nowMs = Date.parse("2026-10-26T15:00:00Z");
    const campaignId = seed(people(1), { schedule: { startTime: "09:00", endTime: "10:00" } });
    const naps: number[] = [];
    const worker = makeWorker({
      sleep: (ms, signal) => {
        naps.push(ms);
        return ms >= 3_600_000 ? blockingSleep(ms, signal) : advancingSleep(ms);
      },
    });
    worker.start(campaignId);
    await waitForStatus(campaignId, "waiting_window");
    expect(naps).toEqual([18 * 3_600_000]);

    nowMs = Date.parse("2026-10-26T20:00:00Z");
    worker.wake("test");
    await waitFor(() => naps.length === 2, "second nap");
    expect(naps[1]).toBe(13 * 3_600_000);
    expect(worker.getActivity().expectedWakeAt).toBe(Date.parse("2026-10-27T09:00:00Z"));

    nowMs = Date.parse("2026-10-27T09:00:00Z");
    worker.wake("test");
    await waitForStatus(campaignId, "completed");
    expect(receivedTo()).toEqual(people(1));
    expect(states(campaignId)).toEqual(["sent"]);
  });

  it("wake() is a no-op when nothing is sleeping", async () => {
    const campaignId = seed(people(2));
    const naps: number[] = [];
    const worker = makeWorker({
      sleep: async (ms) => {
        naps.push(ms);
        await advancingSleep(ms);
      },
    });
    worker.start(campaignId);
    worker.wake("test");
    await waitForStatus(campaignId, "completed");
    expect(naps).toEqual([1000, 1000]);
  });

  it("wake() during the inter-send delay keeps the pacing: it sleeps only the remainder", async () => {
    const campaignId = seed(people(1));
    const naps: number[] = [];
    const worker = makeWorker({
      sleep: (ms, signal) => {
        naps.push(ms);
        return naps.length === 1 ? blockingSleep(ms, signal) : advancingSleep(ms);
      },
    });
    worker.start(campaignId);
    await waitFor(() => naps.length === 1, "inter-send delay");
    nowMs += 400;
    worker.wake("test");
    await waitForStatus(campaignId, "completed");
    expect(naps).toEqual([1000, 600]);
  });

  it("wake() never touches an in-flight send", async () => {
    const campaignId = seed(people(2));
    smtp.setDataBehavior((n) => (n === 1 ? "hang" : "accept"));
    const worker = makeWorker({ sendTimeoutMs: 1_000 });
    worker.start(campaignId);
    await waitFor(() => worker.getActivity().inFlightSince !== null, "in-flight send");
    worker.wake("test");
    await new Promise((r) => setTimeout(r, 100));
    expect(worker.getActivity().inFlightSince).not.toBeNull();
    expect(states(campaignId)).toEqual(["sending", "pending"]);
    await waitForStatus(campaignId, "completed");
    expect(states(campaignId)).toEqual(["uncertain", "sent"]);
  });
});
