import { afterEach, describe, expect, it } from "vitest";
import { setSetting } from "../../server/db/settings.ts";
import { defaultSchedule } from "../../server/domain/schedule.ts";
import { HealthMonitor } from "../../server/health/monitor.ts";
import { authed, makeHarness, type Harness } from "./httpHarness.ts";

let h: Harness;

afterEach(async () => {
  await h?.close();
});

function seedCampaign(db: Harness["db"], status: string): number {
  const listId = Number(
    db
      .prepare("INSERT INTO lists (name, source_label, consent_text, consent_at, status) VALUES ('L','src','yes','2026-10-01T00:00:00Z','ready')")
      .run().lastInsertRowid,
  );
  const templateId = Number(db.prepare("INSERT INTO templates (name, subject, html) VALUES ('T','Hi','<p>Hi</p>')").run().lastInsertRowid);
  const schedule = { ...defaultSchedule("UTC"), sendDays: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "23:59", warmup: false };
  const campaignId = Number(
    db
      .prepare("INSERT INTO campaigns (list_id, template_id, template_version, status, pause_reason, schedule_json) VALUES (?, ?, 1, ?, ?, ?)")
      .run(listId, templateId, status, status === "paused" ? "user" : null, JSON.stringify(schedule)).lastInsertRowid,
  );
  const states = ["pending", "pending", "sent", "failed", "uncertain", "retry", "skipped_suppressed"];
  states.forEach((state, i) => {
    const contactId = Number(
      db.prepare("INSERT INTO contacts (list_id, email, domain) VALUES (?, ?, 'example.com')").run(listId, `c${i}@example.com`).lastInsertRowid,
    );
    db.prepare("INSERT INTO sends (campaign_id, contact_id, state) VALUES (?, ?, ?)").run(campaignId, contactId, state);
  });
  const recent = new Date(Date.now() - 10 * 60_000).toISOString();
  db.prepare("INSERT INTO events (campaign_id, type, message, created_at) VALUES (?, 'sent', 'Sent', ?)").run(campaignId, recent);
  db.prepare("INSERT INTO events (campaign_id, type, message, created_at) VALUES (?, 'failed', 'Failed', ?)").run(campaignId, recent);
  return campaignId;
}

describe("GET /api/health", () => {
  it("reports unknown SMTP/DNS, an idle worker, and unknown network without an SMTP host", async () => {
    let probes = 0;
    h = await makeHarness({ probeNetwork: async () => (probes++, true) });
    const res = await h.app.inject({ method: "GET", url: "/api/health", headers: authed });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.smtp).toEqual({ status: "unknown", detail: expect.any(String), checkedAt: null });
    expect(body.dns.status).toBe("unknown");
    expect(body.network.status).toBe("unknown");
    expect(body.worker).toMatchObject({ status: "ok", loopRunning: false });
    expect(typeof body.worker.heartbeatAgeMs).toBe("number");
    expect(probes).toBe(0);
  });

  it("probes the SMTP host at most once per minute", async () => {
    const asked: string[] = [];
    h = await makeHarness({ probeNetwork: async (host) => (asked.push(host), true) });
    setSetting(h.db, "smtp_host", "smtp.example.com");
    const first = await h.app.inject({ method: "GET", url: "/api/health", headers: authed });
    const second = await h.app.inject({ method: "GET", url: "/api/health", headers: authed });
    expect(first.json().network).toMatchObject({ status: "ok", checkedAt: expect.any(String) });
    expect(second.json().network.status).toBe("ok");
    expect(asked).toEqual(["smtp.example.com"]);
  });

  it("reports a failed network probe", async () => {
    h = await makeHarness({ probeNetwork: async () => false });
    setSetting(h.db, "smtp_host", "smtp.example.com");
    const res = await h.app.inject({ method: "GET", url: "/api/health", headers: authed });
    expect(res.json().network.status).toBe("fail");
    expect(res.json().network.detail).toContain("smtp.example.com");
  });
});

describe("HealthMonitor", () => {
  it("persists SMTP and DNS results across restarts and notifies on change only", async () => {
    h = await makeHarness();
    const changes: unknown[] = [];
    const monitor = new HealthMonitor({ db: h.db, worker: h.worker, getSmtpHost: () => "", onChange: (x) => changes.push(x) });
    const item = { status: "ok" as const, detail: "Connected", checkedAt: "2026-10-26T00:00:00.000Z" };
    monitor.set("smtp", item);
    monitor.set("smtp", item);
    expect(changes).toHaveLength(1);
    monitor.set("dns", { status: "fail", detail: "No DMARC", checkedAt: item.checkedAt });
    expect(changes).toHaveLength(2);

    const reborn = new HealthMonitor({ db: h.db, worker: h.worker, getSmtpHost: () => "" });
    expect(reborn.get().smtp).toEqual(item);
    expect(reborn.get().dns.status).toBe("fail");

    reborn.reset("smtp");
    expect(new HealthMonitor({ db: h.db, worker: h.worker, getSmtpHost: () => "" }).get().smtp.status).toBe("unknown");
  });

  it("survives corrupt persisted health JSON", async () => {
    h = await makeHarness();
    setSetting(h.db, "health_smtp_json", "{not json");
    setSetting(h.db, "health_dns_json", JSON.stringify({ status: "weird" }));
    const monitor = new HealthMonitor({ db: h.db, worker: h.worker, getSmtpHost: () => "" });
    expect(monitor.get().smtp.status).toBe("unknown");
    expect(monitor.get().dns.status).toBe("unknown");
  });

  it("flags an active campaign whose send loop is not running", async () => {
    h = await makeHarness();
    const activity = {
      campaignId: 1,
      status: "running" as const,
      heartbeatAt: Date.now(),
      inFlightSince: null,
      expectedWakeAt: null,
      delaySeconds: 10,
      loopRunning: false,
    };
    const monitor = new HealthMonitor({ db: h.db, worker: { getActivity: () => activity }, getSmtpHost: () => "" });
    expect(monitor.get().worker).toMatchObject({ status: "fail", loopRunning: false });
    activity.loopRunning = true;
    expect(monitor.get().worker.status).toBe("ok");
    activity.heartbeatAt = Date.now() - 10 * 60_000;
    expect(monitor.get().worker.status).toBe("fail");
  });
});

describe("GET /api/status", () => {
  it("returns no campaign when the worker has none", async () => {
    h = await makeHarness();
    const res = await h.app.inject({ method: "GET", url: "/api/status", headers: authed });
    expect(res.json()).toEqual({
      campaign: null,
      worker: { status: null, heartbeatAgeMs: expect.any(Number), loopRunning: false, inFlight: false },
    });
  });

  it("describes the worker's campaign with counts, stats and an estimate", async () => {
    h = await makeHarness();
    const id = seedCampaign(h.db, "paused");
    h.worker.recoverOnBoot();
    const res = await h.app.inject({ method: "GET", url: "/api/status", headers: authed });
    const { campaign, worker } = res.json();
    expect(worker.status).toBe("paused");
    expect(campaign).toMatchObject({
      id,
      status: "paused",
      pauseReason: "user",
      templateVersion: 1,
      startedAt: null,
      finishedAt: null,
      counts: { pending: 2, sending: 0, sent: 1, retry: 1, failed: 1, uncertain: 1, skipped_suppressed: 1, total: 7 },
      stats: { sentLastHour: 1, rejectionRate: 0.5, sample: 2 },
    });
    expect(campaign.schedule.timezone).toBe("UTC");
    expect(campaign.estimate.perDay.reduce((n: number, d: { count: number }) => n + d.count, 0)).toBe(3);
  });
});
