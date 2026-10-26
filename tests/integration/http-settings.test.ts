import fs from "node:fs";
import { parseEnv } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AuthResolver } from "../../server/dns/check.ts";
import { buildServer } from "../../server/http/server.ts";
import { startFakeSmtp, type FakeSmtp } from "../fakeSmtp.ts";
import { authed, makeHarness, mutating, type Harness } from "./httpHarness.ts";

let h: Harness;
let savedTestSmtp: string | undefined;

beforeAll(() => {
  savedTestSmtp = process.env.MAMADIRECT_TEST_SMTP;
  process.env.MAMADIRECT_TEST_SMTP = "1";
});

afterAll(() => {
  if (savedTestSmtp === undefined) delete process.env.MAMADIRECT_TEST_SMTP;
  else process.env.MAMADIRECT_TEST_SMTP = savedTestSmtp;
});

afterEach(async () => {
  await h?.close();
});

const put = (payload: unknown) => h.app.inject({ method: "PUT", url: "/api/settings", headers: mutating, payload: payload as object });
const get = () => h.app.inject({ method: "GET", url: "/api/settings", headers: authed });

describe("GET/PUT /api/settings", () => {
  it("returns defaults", async () => {
    h = await makeHarness();
    expect((await get()).json()).toEqual({
      provider: "ses",
      sesRegion: null,
      operatorName: "",
      organization: "",
      setupCompletedAt: null,
      fromName: "",
      fromEmail: "",
      replyTo: null,
      postalAddress: "",
      unsubMailbox: "",
      publicBaseUrl: null,
      dkimSelector: null,
      timezone: "UTC",
      testInboxes: [],
      smtp: { host: "", port: 587, secure: false, user: "", passSet: false },
    });
  });

  it("round-trips every field, normalizing emails and trimming text", async () => {
    h = await makeHarness();
    const res = await put({
      provider: "smtp",
      sesRegion: "eu-west-1",
      operatorName: " Olive ",
      organization: "Mama Co",
      fromName: "  Mama Direct ",
      fromEmail: "News@Mail.Example.com",
      replyTo: "reply@example.com",
      postalAddress: "PO Box 1\r\nSpringfield",
      unsubMailbox: "unsub@mail.example.com",
      publicBaseUrl: "https://unsub.example.com/mail/",
      dkimSelector: "s1",
      timezone: "Europe/London",
      testInboxes: ["Me@Gmail.com", "me@gmail.com", "me@outlook.com"],
      smtp: { host: "smtp.example.com", port: 465, secure: true, user: "apikey" },
    });
    expect(res.statusCode).toBe(200);
    const expected = {
      provider: "smtp",
      sesRegion: "eu-west-1",
      operatorName: "Olive",
      organization: "Mama Co",
      setupCompletedAt: null,
      fromName: "Mama Direct",
      fromEmail: "news@mail.example.com",
      replyTo: "reply@example.com",
      postalAddress: "PO Box 1\nSpringfield",
      unsubMailbox: "unsub@mail.example.com",
      publicBaseUrl: "https://unsub.example.com/mail",
      dkimSelector: "s1",
      timezone: "Europe/London",
      testInboxes: ["me@gmail.com", "me@outlook.com"],
      smtp: { host: "smtp.example.com", port: 465, secure: true, user: "apikey", passSet: false },
    };
    expect(res.json()).toEqual(expected);
    expect((await get()).json()).toEqual(expected);

    const partial = await put({ fromName: "New", replyTo: null, publicBaseUrl: "", dkimSelector: null });
    expect(partial.json()).toMatchObject({ fromName: "New", replyTo: null, publicBaseUrl: null, dkimSelector: null, fromEmail: "news@mail.example.com" });
  });

  it("accepts the whole SettingsView back, including passSet", async () => {
    h = await makeHarness();
    const view = (await get()).json();
    const res = await put(view);
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ["a bad email", { fromEmail: "not-an-email" }],
    ["CRLF in fromName", { fromName: "Mama\r\nBcc: victim@example.com" }],
    ["an http publicBaseUrl", { publicBaseUrl: "http://unsub.example.com" }],
    ["credentials in the URL", { publicBaseUrl: "https://user:pw@unsub.example.com" }],
    ["a query in the URL", { publicBaseUrl: "https://unsub.example.com/?x=1" }],
    ["a bad timezone", { timezone: "Mars/Olympus" }],
    ["port 0", { smtp: { port: 0 } }],
    ["port 65536", { smtp: { port: 65536 } }],
    ["a mailbox with ?", { unsubMailbox: "unsub@example.com?subject=x" }],
    ["a mailbox with a comma", { unsubMailbox: "a@example.com,b@example.com" }],
    ["a mailbox with angle brackets", { unsubMailbox: "<a@example.com>x" }],
    ["11 test inboxes", { testInboxes: Array.from({ length: 11 }, (_, i) => `t${i}@example.com`) }],
    ["an over-long name", { fromName: "x".repeat(501) }],
    ["an unknown key", { fromNmae: "typo" }],
    ["pass and clearPass together", { smtp: { pass: "x", clearPass: true } }],
    ["a password with a newline", { smtp: { pass: "a\nb" } }],
    ["a bad DKIM selector", { dkimSelector: "s1; rm -rf" }],
    ["a host with spaces", { smtp: { host: "smtp example.com" } }],
  ])("rejects %s", async (_label, payload) => {
    h = await makeHarness();
    const res = await put(payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_request");
    expect((await get()).json().fromName).toBe("");
  });

  it("writes the SMTP password to .env (mode 0600) and only ever reports passSet", async () => {
    const registered: string[] = [];
    h = await makeHarness({ registerSecret: (v) => registered.push(v) });
    const secret = "Sup3r-Secret-Pa55word!";
    const res = await put({ smtp: { pass: secret } });
    expect(res.statusCode).toBe(200);
    expect(res.json().smtp.passSet).toBe(true);
    expect(res.body).not.toContain(secret);
    expect(parseEnv(fs.readFileSync(h.paths.envPath, "utf8")).SMTP_PASS).toBe(secret);
    if (process.platform !== "win32") expect(fs.statSync(h.paths.envPath).mode & 0o777).toBe(0o600);
    expect(h.env.SMTP_PASS).toBe(secret);
    expect(registered).toContain(secret);
    expect(JSON.stringify(h.db.prepare("SELECT * FROM settings").all())).not.toContain(secret);

    const cleared = await put({ smtp: { clearPass: true } });
    expect(cleared.json().smtp.passSet).toBe(false);
    expect(fs.readFileSync(h.paths.envPath, "utf8")).not.toContain("SMTP_PASS");
    expect(h.env.SMTP_PASS).toBeUndefined();
  });

  it("resets SMTP health when SMTP settings change and DNS health when the from address or selector change", async () => {
    h = await makeHarness();
    const ok = { status: "ok" as const, detail: "fine", checkedAt: "2026-10-26T00:00:00.000Z" };
    h.health.set("smtp", ok);
    h.health.set("dns", ok);
    await put({ fromName: "Unrelated" });
    expect(h.health.get().smtp.status).toBe("ok");
    expect(h.health.get().dns.status).toBe("ok");
    await put({ smtp: { host: "smtp.other.com" } });
    expect(h.health.get().smtp.status).toBe("unknown");
    expect(h.health.get().dns.status).toBe("ok");
    h.health.set("smtp", ok);
    await put({ smtp: { pass: "new-password" } });
    expect(h.health.get().smtp.status).toBe("unknown");
    await put({ fromEmail: "x@other.com" });
    expect(h.health.get().dns.status).toBe("unknown");
    h.health.set("dns", ok);
    await put({ dkimSelector: "s2" });
    expect(h.health.get().dns.status).toBe("unknown");
  });
});

describe("POST /api/settings/smtp/test", () => {
  let smtp: FakeSmtp;

  afterEach(async () => {
    await smtp?.close();
  });

  it("passes against the fake SMTP server and records SMTP health", async () => {
    smtp = await startFakeSmtp({ user: "mama", pass: "right-password" });
    h = await makeHarness();
    await put({ provider: "smtp", smtp: { host: "127.0.0.1", port: smtp.port, secure: false, user: "mama", pass: "right-password" } });
    const res = await h.app.inject({ method: "POST", url: "/api/settings/smtp/test", headers: mutating });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, message: expect.any(String) });
    expect(h.health.get().smtp).toMatchObject({ status: "ok", checkedAt: expect.any(String) });
  });

  it("fails with a bad password without echoing it", async () => {
    smtp = await startFakeSmtp({ user: "mama", pass: "right-password" });
    h = await makeHarness();
    const wrong = "Wrong-Password-123";
    await put({ provider: "smtp", smtp: { host: "127.0.0.1", port: smtp.port, secure: false, user: "mama", pass: wrong } });
    const res = await h.app.inject({ method: "POST", url: "/api/settings/smtp/test", headers: mutating });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    expect(res.json().message).toMatch(/login|auth|535/i);
    expect(res.body).not.toContain(wrong);
    expect(res.body).not.toContain(Buffer.from(wrong).toString("base64"));
    expect(h.health.get().smtp.status).toBe("fail");
    expect(JSON.stringify(h.health.get())).not.toContain(wrong);
  });

  it("explains what is missing before trying to connect", async () => {
    let called = false;
    h = await makeHarness({ verifySmtp: async () => void (called = true) });
    await put({ provider: "smtp" });
    const res = await h.app.inject({ method: "POST", url: "/api/settings/smtp/test", headers: mutating });
    expect(res.json()).toEqual({ ok: false, message: expect.stringMatching(/host/i) });
    expect(called).toBe(false);
  });

  it("gives up on a server that never answers", async () => {
    h = await makeHarness({
      verifySmtp: () => new Promise(() => {}),
      build: (deps) => buildServer({ ...deps, smtpTestTimeoutMs: 100 }),
    });
    await put({ provider: "smtp", smtp: { host: "smtp.example.com", user: "u", pass: "p" } });
    const started = Date.now();
    const res = await h.app.inject({ method: "POST", url: "/api/settings/smtp/test", headers: mutating });
    expect(res.json()).toEqual({ ok: false, message: expect.stringMatching(/did not answer|timed out/i) });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(h.health.get().smtp.status).toBe("fail");
  });
});

describe("POST /api/settings/dns/check", () => {
  const records: Record<string, string[][]> = {
    "example.com": [["v=spf1 include:_spf.provider.com ~all"]],
    "_dmarc.example.com": [["v=DMARC1; p=quarantine"]],
    "s1._domainkey.example.com": [["v=DKIM1; p=MIGf"]],
  };
  const resolverFor = (txt: Record<string, string[][]>): AuthResolver => ({
    resolveTxt: async (name) => {
      if (txt[name]) return txt[name];
      throw Object.assign(new Error("nope"), { code: "ENOTFOUND" });
    },
    resolveCname: async () => {
      throw Object.assign(new Error("nope"), { code: "ENODATA" });
    },
  });

  it("passes when all three records exist and records DNS health", async () => {
    h = await makeHarness({ dnsResolver: resolverFor(records) });
    await put({ fromEmail: "news@example.com", dkimSelector: "s1" });
    const res = await h.app.inject({ method: "POST", url: "/api/settings/dns/check", headers: mutating });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ domain: "example.com", ok: true, spf: { ok: true }, dkim: { ok: true, selector: "s1" }, dmarc: { ok: true } });
    expect(h.health.get().dns.status).toBe("ok");
  });

  it("fails on a missing DMARC record", async () => {
    const { "_dmarc.example.com": _x, ...rest } = records;
    h = await makeHarness({ dnsResolver: resolverFor(rest) });
    await put({ fromEmail: "news@example.com", dkimSelector: "s1" });
    const res = await h.app.inject({ method: "POST", url: "/api/settings/dns/check", headers: mutating });
    expect(res.json()).toMatchObject({ ok: false, dmarc: { ok: false, record: null } });
    expect(h.health.get().dns.status).toBe("fail");
    expect(h.health.get().dns.detail).toMatch(/DMARC/);
  });

  it("asks for a selector when none is set", async () => {
    h = await makeHarness({ dnsResolver: resolverFor(records) });
    await put({ fromEmail: "news@example.com" });
    const res = await h.app.inject({ method: "POST", url: "/api/settings/dns/check", headers: mutating });
    expect(res.json().dkim).toEqual({ ok: false, selector: null, detail: "Enter your email provider's DKIM selector" });
  });

  it("needs a from address", async () => {
    h = await makeHarness({ dnsResolver: resolverFor(records) });
    const res = await h.app.inject({ method: "POST", url: "/api/settings/dns/check", headers: mutating });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("from_email_missing");
  });
});
