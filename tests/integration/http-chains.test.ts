import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Schedule } from "../../server/domain/schedule.ts";
import type { HealthItem } from "../../server/http/contract.ts";
import { startFakeSmtp, type FakeSmtp } from "../fakeSmtp.ts";
import {
  authed,
  configureSender,
  makeHarness,
  mutating,
  seedList,
  type Harness,
} from "./httpHarness.ts";

let h: Harness;
let smtp: FakeSmtp;
let savedTestSmtp: string | undefined;

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
});

afterEach(async () => {
  await h?.close();
  await smtp.close();
});

const post = (url: string, payload?: unknown) =>
  h.app.inject({ method: "POST", url, headers: mutating, ...(payload === undefined ? {} : { payload: payload as object }) });

const ALL_DAY: Schedule = {
  timezone: "UTC",
  sendDays: [0, 1, 2, 3, 4, 5, 6],
  startTime: "00:00",
  endTime: "23:59",
  dailyCap: 2000,
  warmup: false,
  delaySeconds: 1,
};

const ok = (detail: string): HealthItem => ({ status: "ok", detail, checkedAt: new Date().toISOString() });

async function seedChain(): Promise<{ chainId: number }> {
  h = await makeHarness({
    linkChecker: { fetchImpl: async () => new Response(null, { status: 200 }), lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
  });
  await configureSender(h, smtp.port);
  h.health.set("smtp", ok("Connected"));
  h.health.set("dns", ok("fine"));
  h.db.exec("BEGIN");
  const { listId } = seedList(h.db, [{ email: "ann@x.example", fields: { first_name: "Ann" } }]);
  h.db.exec("COMMIT");
  const createdTpl = await post("/api/templates", {
    name: "Welcome",
    subject: "Hello",
    html: '<p>Hi</p><a href="https://site.example/">site</a>',
  });
  const templateId = createdTpl.json().id as number;
  expect((await post(`/api/templates/${templateId}/link-check`)).statusCode).toBe(200);
  expect((await post(`/api/templates/${templateId}/test-send`, {})).json().results.every((r: { ok: boolean }) => r.ok)).toBe(true);
  smtp.received.length = 0;
  const created = await post("/api/chains", {
    name: "Nurture",
    listId,
    schedule: ALL_DAY,
    steps: [{ templateId, delayHours: 0 }],
  });
  expect(created.statusCode).toBe(201);
  return { chainId: created.json().id as number };
}

describe("POST /api/chains/:id/start", () => {
  it("creates a draft but does not start when launch gates fail", async () => {
    const { chainId } = await seedChain();
    h.health.reset("smtp");
    const started = await post(`/api/chains/${chainId}/start`, { autoStart: true });
    expect(started.statusCode).toBe(409);
    expect(started.json().error.code).toBe("gates_failed");

    const campaigns = await h.app.inject({ method: "GET", url: "/api/campaigns", headers: authed });
    const rows = campaigns.json() as { status: string; title: string | null }[];
    expect(rows.some((c) => c.status === "draft" && (c.title ?? "").includes("Nurture"))).toBe(true);
  });

  it("refuses auto-start when setup is incomplete", async () => {
    const { chainId } = await seedChain();
    h.db.prepare("DELETE FROM settings WHERE key = ?").run("setup_completed_at");
    const started = await post(`/api/chains/${chainId}/start`, { autoStart: true });
    expect(started.statusCode).toBe(409);
    expect(started.json().error.code).toBe("setup_incomplete");
  });

  it("auto-starts when setup and gates pass", async () => {
    const { chainId } = await seedChain();
    const started = await post(`/api/chains/${chainId}/start`, { autoStart: true });
    expect(started.statusCode).toBe(200);
    expect(["running", "completed"]).toContain(started.json().status);
  });
});
