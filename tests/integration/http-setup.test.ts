import { afterEach, describe, expect, it } from "vitest";
import type { MailTransport, SmtpConfig } from "../../server/send/transport.ts";
import { SES_REGIONS } from "../../server/settings/sesRegions.ts";
import { getSenderConfig } from "../../server/settings/store.ts";
import { authed, makeHarness, mutating, type Harness } from "./httpHarness.ts";

let h: Harness;

afterEach(async () => {
  await h?.close();
});

const put = (payload: unknown) => h.app.inject({ method: "PUT", url: "/api/settings", headers: mutating, payload: payload as object });
const getSetup = () => h.app.inject({ method: "GET", url: "/api/setup", headers: authed });
const post = (url: string) => h.app.inject({ method: "POST", url, headers: mutating });

const noSteps = { operator: false, provider: false, domain: false, addresses: false, testInboxes: false };
const dnsOk = { status: "ok" as const, detail: "fine", checkedAt: "2026-10-26T00:00:00.000Z" };

describe("settings: provider, region, operator and organization", () => {
  it("defaults to Amazon SES with no region and blank operator fields", async () => {
    h = await makeHarness();
    const view = (await h.app.inject({ method: "GET", url: "/api/settings", headers: authed })).json();
    expect(view).toMatchObject({ provider: "ses", sesRegion: null, operatorName: "", organization: "", setupCompletedAt: null });
  });

  it("round-trips the new fields, trimming text", async () => {
    h = await makeHarness();
    const res = await put({ provider: "smtp", sesRegion: "eu-west-2", operatorName: "  Olive Smith ", organization: " Mama Co " });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ provider: "smtp", sesRegion: "eu-west-2", operatorName: "Olive Smith", organization: "Mama Co" });
    expect((await put({ sesRegion: "" })).json().sesRegion).toBeNull();
    expect((await put({ sesRegion: "us-east-1" })).json().sesRegion).toBe("us-east-1");
    expect((await put({ sesRegion: null })).json().sesRegion).toBeNull();
  });

  it.each([
    ["an unknown region", { sesRegion: "mars-north-1" }],
    ["a region with odd case", { sesRegion: "US-EAST-1" }],
    ["an unknown provider", { provider: "sendgrid" }],
    ["an over-long operator name", { operatorName: "x".repeat(121) }],
    ["CRLF in the organization", { organization: "Mama\r\nBcc: x@example.com" }],
    ["a line break in the operator name", { operatorName: "Olive\nSmith" }],
  ])("rejects %s", async (_label, payload) => {
    h = await makeHarness();
    const res = await put(payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_request");
  });

  it("ignores setupCompletedAt in PUT, so a SettingsView can be sent back", async () => {
    h = await makeHarness();
    const res = await put({ setupCompletedAt: "2026-01-01T00:00:00.000Z" });
    expect(res.statusCode).toBe(200);
    expect(res.json().setupCompletedAt).toBeNull();
  });

  it("resets SMTP health when the provider or region changes", async () => {
    h = await makeHarness();
    h.health.set("smtp", dnsOk);
    await put({ operatorName: "Olive", organization: "Mama Co" });
    expect(h.health.get().smtp.status).toBe("ok");
    await put({ sesRegion: "eu-west-1" });
    expect(h.health.get().smtp.status).toBe("unknown");
    h.health.set("smtp", dnsOk);
    await put({ sesRegion: "eu-west-1" });
    expect(h.health.get().smtp.status).toBe("ok");
    await put({ provider: "smtp" });
    expect(h.health.get().smtp.status).toBe("unknown");
  });
});

describe("Amazon SES derived SMTP endpoint", () => {
  const sesSettings = {
    provider: "ses",
    sesRegion: "eu-west-2",
    smtp: { host: "smtp.stored.example", port: 2525, secure: true, user: "AKIASESSMTPUSER", pass: "ses-smtp-password" },
  };

  it("derives host, port 587 and STARTTLS in getSenderConfig and ignores the stored SMTP fields", async () => {
    h = await makeHarness();
    await put(sesSettings);
    expect(getSenderConfig(h.db, h.env).smtp).toEqual({
      host: "email-smtp.eu-west-2.amazonaws.com",
      port: 587,
      secure: false,
      user: "AKIASESSMTPUSER",
      pass: "ses-smtp-password",
    });
    const view = (await h.app.inject({ method: "GET", url: "/api/settings", headers: authed })).json();
    expect(view.smtp).toEqual({ host: "smtp.stored.example", port: 2525, secure: true, user: "AKIASESSMTPUSER", passSet: true });

    await put({ provider: "smtp" });
    expect(getSenderConfig(h.db, h.env).smtp).toMatchObject({ host: "smtp.stored.example", port: 2525, secure: true });
  });

  it("passes the derived endpoint to the SMTP test", async () => {
    const seen: SmtpConfig[] = [];
    h = await makeHarness({ verifySmtp: async (cfg) => void seen.push(cfg) });
    await put(sesSettings);
    const res = await post("/api/settings/smtp/test");
    expect(res.json()).toEqual({ ok: true, message: expect.stringContaining("email-smtp.eu-west-2.amazonaws.com:587") });
    expect(seen).toEqual([expect.objectContaining({ host: "email-smtp.eu-west-2.amazonaws.com", port: 587, secure: false, user: "AKIASESSMTPUSER" })]);
  });

  it("asks for the region before testing when SES has none, even with a stored host", async () => {
    let called = false;
    h = await makeHarness({ verifySmtp: async () => void (called = true) });
    await put({ ...sesSettings, sesRegion: null });
    const res = await post("/api/settings/smtp/test");
    expect(res.json()).toEqual({ ok: false, message: expect.stringMatching(/region/i) });
    expect(called).toBe(false);
  });

  it("hands the derived endpoint to the transport factory for a test send", async () => {
    const built: SmtpConfig[] = [];
    const transport: MailTransport = {
      send: async () => ({ messageId: "<m@x>", response: "250 ok" }),
      verify: async () => {},
      close: () => {},
    };
    h = await makeHarness({ createTransport: (cfg) => (built.push(cfg), transport) });
    await put({
      ...sesSettings,
      fromEmail: "hello@mama.example",
      postalAddress: "PO Box 1",
      unsubMailbox: "unsub@mama.example",
      testInboxes: ["me@mine.example"],
    });
    const created = await h.app.inject({
      method: "POST",
      url: "/api/templates",
      headers: mutating,
      payload: { name: "T", subject: "Hi", html: "<p>Hi</p><p>{{postal_address}} {{unsubscribe_url}}</p>" },
    });
    const res = await post(`/api/templates/${created.json().id}/test-send`);
    expect(res.statusCode).toBe(200);
    expect(built.map((c) => [c.host, c.port, c.secure])).toEqual([["email-smtp.eu-west-2.amazonaws.com", 587, false]]);
  });

  it("probes the network against the derived host", async () => {
    const probed: string[] = [];
    h = await makeHarness({ probeNetwork: async (host) => (probed.push(host), true) });
    await put(sesSettings);
    await h.app.inject({ method: "GET", url: "/api/health", headers: authed });
    expect(probed).toEqual(["email-smtp.eu-west-2.amazonaws.com"]);
  });
});

describe("/api/setup", () => {
  it("lists the SES regions and reports every step incomplete on a fresh install", async () => {
    h = await makeHarness();
    const res = await getSetup();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ complete: false, completedAt: null, steps: noSteps, regions: SES_REGIONS });
    expect(SES_REGIONS).toHaveLength(21);
    expect(SES_REGIONS[0]).toEqual({ id: "us-east-1", label: "N. Virginia" });
  });

  it("flips each step as the settings are filled in", async () => {
    h = await makeHarness();
    const steps = async () => (await getSetup()).json().steps;

    await put({ operatorName: "   " });
    expect((await steps()).operator).toBe(false);
    await put({ operatorName: "Olive" });
    expect(await steps()).toEqual({ ...noSteps, operator: true });

    await put({ sesRegion: "us-east-1", smtp: { user: "AKIASES" } });
    expect((await steps()).provider).toBe(false);
    await put({ smtp: { pass: "ses-pass" } });
    expect((await steps()).provider).toBe(true);
    await put({ sesRegion: null });
    expect((await steps()).provider).toBe(false);
    await put({ provider: "smtp" });
    expect((await steps()).provider).toBe(false);
    await put({ smtp: { host: "smtp.example.com" } });
    expect((await steps()).provider).toBe(true);
    await put({ smtp: { user: "" } });
    expect((await steps()).provider).toBe(false);
    await put({ smtp: { user: "apikey" } });

    await put({ fromEmail: "hello@mama.example", unsubMailbox: "unsub@mama.example" });
    expect(await steps()).toMatchObject({ addresses: false, domain: false });
    await put({ postalAddress: "PO Box 1" });
    expect(await steps()).toMatchObject({ addresses: true, domain: false });

    h.health.set("dns", dnsOk);
    expect((await steps()).domain).toBe(true);
    h.health.set("dns", { ...dnsOk, status: "fail" });
    expect((await steps()).domain).toBe(false);

    await put({ testInboxes: ["me@mine.example"] });
    expect(await steps()).toEqual({ operator: true, provider: true, domain: false, addresses: true, testInboxes: true });
  });

  it("refuses to complete until the required steps pass, then completes without DNS", async () => {
    h = await makeHarness();
    await put({ operatorName: "Olive", sesRegion: "us-east-1", smtp: { user: "AKIASES", pass: "ses-pass" } });
    const refused = await post("/api/setup/complete");
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: "setup_incomplete",
      details: { operator: true, provider: true, domain: false, addresses: false, testInboxes: false },
    });
    expect((await getSetup()).json().complete).toBe(false);

    await put({ fromEmail: "hello@mama.example", unsubMailbox: "unsub@mama.example", postalAddress: "PO Box 1", testInboxes: ["me@mine.example"] });
    const before = Date.now();
    const done = await post("/api/setup/complete");
    expect(done.statusCode).toBe(200);
    const body = done.json();
    expect(body).toMatchObject({ complete: true, steps: { domain: false, operator: true }, regions: SES_REGIONS });
    expect(Date.parse(body.completedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect((await getSetup()).json()).toEqual(body);
    expect((await h.app.inject({ method: "GET", url: "/api/settings", headers: authed })).json().setupCompletedAt).toBe(body.completedAt);
  });

  it("resets only the completion marker", async () => {
    h = await makeHarness();
    await put({
      operatorName: "Olive",
      provider: "smtp",
      smtp: { host: "smtp.example.com", user: "apikey", pass: "p" },
      fromEmail: "hello@mama.example",
      unsubMailbox: "unsub@mama.example",
      postalAddress: "PO Box 1",
      testInboxes: ["me@mine.example"],
    });
    expect((await post("/api/setup/complete")).statusCode).toBe(200);
    const reset = await post("/api/setup/reset");
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ complete: false, completedAt: null, steps: { operator: true, provider: true, addresses: true, testInboxes: true } });
    const settings = (await h.app.inject({ method: "GET", url: "/api/settings", headers: authed })).json();
    expect(settings).toMatchObject({ operatorName: "Olive", fromEmail: "hello@mama.example", setupCompletedAt: null });
  });

  it("keeps the session and header checks", async () => {
    h = await makeHarness();
    expect((await h.app.inject({ method: "GET", url: "/api/setup", headers: { host: authed.host } })).statusCode).toBe(401);
    expect((await h.app.inject({ method: "POST", url: "/api/setup/complete", headers: authed })).statusCode).toBe(403);
    expect((await h.app.inject({ method: "POST", url: "/api/setup/reset", headers: authed })).statusCode).toBe(403);
  });
});
