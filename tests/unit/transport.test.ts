import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTransport, transportOptions, verifyTransport, type SmtpConfig } from "../../server/send/transport.ts";
import { startFakeSmtp, type FakeSmtp } from "../fakeSmtp.ts";

const PASS = "s3cr3t-Pa55word!";

function cfg(overrides: Partial<SmtpConfig> = {}): SmtpConfig {
  return { host: "127.0.0.1", port: 2525, secure: false, user: "test", pass: PASS, ...overrides };
}

function base64Forms(user: string, pass: string): string[] {
  return [Buffer.from(pass).toString("base64"), Buffer.from(`\u0000${user}\u0000${pass}`).toString("base64")];
}

function allText(err: unknown): string {
  const e = err as Record<string, unknown>;
  return [String(err), e.message, e.stack, e.response].filter((v) => typeof v === "string").join("\n");
}

describe("transportOptions — TLS verification (R17)", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.ARCHER_TEST_SMTP;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.ARCHER_TEST_SMTP;
    else process.env.ARCHER_TEST_SMTP = saved;
  });

  it.each(["127.0.0.1", "localhost"])("disables certificate checks only for %s with ARCHER_TEST_SMTP=1", (host) => {
    process.env.ARCHER_TEST_SMTP = "1";
    expect(transportOptions(cfg({ host })).tls).toMatchObject({ rejectUnauthorized: false });
  });

  it("keeps certificate checks for a remote host even with ARCHER_TEST_SMTP=1", () => {
    process.env.ARCHER_TEST_SMTP = "1";
    expect(transportOptions(cfg({ host: "smtp.example.com" })).tls).toMatchObject({ rejectUnauthorized: true });
  });

  it.each(["127.0.0.1", "localhost"])("keeps certificate checks for %s without the env flag", (host) => {
    delete process.env.ARCHER_TEST_SMTP;
    expect(transportOptions(cfg({ host })).tls).toMatchObject({ rejectUnauthorized: true });
  });

  it("requires the flag to be exactly '1'", () => {
    process.env.ARCHER_TEST_SMTP = "true";
    expect(transportOptions(cfg()).tls).toMatchObject({ rejectUnauthorized: true });
  });
});

describe("transportOptions — connection policy", () => {
  it("uses one pooled connection, never requeues, and mandates STARTTLS on non-implicit TLS", () => {
    const o = transportOptions(cfg({ host: "smtp.example.com", port: 587 }));
    expect(o).toMatchObject({
      pool: true,
      maxConnections: 1,
      maxMessages: 100,
      maxRequeues: 0,
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "test", pass: PASS },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
    expect(o.tls).toMatchObject({ minVersion: "TLSv1.2" });
  });

  it("uses implicit TLS when secure is set", () => {
    const o = transportOptions(cfg({ host: "smtp.example.com", port: 465, secure: true }));
    expect(o.secure).toBe(true);
    expect(o.requireTLS).not.toBe(true);
  });

  it("honours timeout overrides", () => {
    const o = transportOptions(cfg({ connectionTimeoutMs: 100, greetingTimeoutMs: 200, socketTimeoutMs: 300 }));
    expect(o).toMatchObject({ connectionTimeout: 100, greetingTimeout: 200, socketTimeout: 300 });
  });
});

describe("transport against the fake SMTP server", () => {
  let smtp: FakeSmtp;
  let saved: string | undefined;

  beforeAll(() => {
    saved = process.env.ARCHER_TEST_SMTP;
    process.env.ARCHER_TEST_SMTP = "1";
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.ARCHER_TEST_SMTP;
    else process.env.ARCHER_TEST_SMTP = saved;
  });
  beforeEach(async () => {
    smtp = await startFakeSmtp({ user: "test", pass: PASS });
  });
  afterEach(async () => {
    await smtp.close();
  });

  const message = {
    from: { name: "Mama", address: "hello@example.com" },
    to: "jane@example.org",
    subject: "Hi",
    html: "<p>Hi</p>",
    text: "Hi",
    headers: { "List-Unsubscribe": "<mailto:u@example.com>" },
  };

  it("verifies and sends over STARTTLS", async () => {
    await expect(verifyTransport(cfg({ port: smtp.port }))).resolves.toBeUndefined();
    const t = buildTransport(cfg({ port: smtp.port }));
    try {
      const info = await t.send(message);
      expect(info.response).toMatch(/^250 /);
      expect(info.messageId).toMatch(/@/);
    } finally {
      t.close();
    }
    expect(smtp.received).toHaveLength(1);
    expect(smtp.received[0].to).toEqual(["jane@example.org"]);
  });

  it("rejects verify with the auth error and never exposes the password", async () => {
    const err = await verifyTransport(cfg({ port: smtp.port, pass: `${PASS}-wrong` })).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "EAUTH", responseCode: 535 });
    const text = allText(err);
    for (const secret of [`${PASS}-wrong`, ...base64Forms("test", `${PASS}-wrong`)]) expect(text).not.toContain(secret);
  });

  it("redacts the password even when the server echoes it back", async () => {
    smtp.setMailFromBehavior(() => ({ code: 550, message: `5.7.1 refusing ${PASS} and ${base64Forms("test", PASS)[1]}` }));
    const t = buildTransport(cfg({ port: smtp.port }));
    try {
      const err = await t.send(message).catch((e: unknown) => e);
      expect(err).toMatchObject({ responseCode: 550, command: "MAIL FROM" });
      const text = allText(err);
      for (const secret of [PASS, ...base64Forms("test", PASS)]) expect(text).not.toContain(secret);
      expect(text).toContain("***");
    } finally {
      t.close();
    }
  });

  it("tags a connection dropped after the server accepted DATA as a DATA-stage failure", async () => {
    smtp.setDataBehavior(() => "drop");
    const t = buildTransport(cfg({ port: smtp.port }));
    try {
      const err = await t.send(message).catch((e: unknown) => e);
      expect(err).toMatchObject({ command: "DATA" });
    } finally {
      t.close();
    }
  });

  it("does not tag a connection dropped before DATA", async () => {
    smtp.setMailFromBehavior(() => "drop");
    const t = buildTransport(cfg({ port: smtp.port }));
    try {
      const err = (await t.send(message).catch((e: unknown) => e)) as { command?: string; code?: string };
      expect(err.command).not.toBe("DATA");
      expect(err.code).toMatch(/^E/);
    } finally {
      t.close();
    }
  });
});
