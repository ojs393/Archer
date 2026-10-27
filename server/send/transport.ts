import nodemailer from "nodemailer";
import type { SMTPPoolOptions } from "nodemailer/lib/smtp-pool";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  connectionTimeoutMs?: number;
  greetingTimeoutMs?: number;
  socketTimeoutMs?: number;
}

export interface OutgoingMessage {
  from: { name: string; address: string };
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export interface MailTransport {
  send(msg: OutgoingMessage): Promise<{ messageId: string; response: string }>;
  verify(): Promise<void>;
  close(): void;
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);
const REDACTED = "***";
const DATA_ACCEPTED = /^354[ -]/;

function allowSelfSigned(host: string): boolean {
  return process.env.ARCHER_TEST_SMTP === "1" && LOCAL_HOSTS.has(host.toLowerCase());
}

export function transportOptions(cfg: SmtpConfig): SMTPPoolOptions & { pool: true } {
  return {
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    // The pool would otherwise resend a message whose connection closed mid-send: a possible duplicate.
    maxRequeues: 0,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    ...(cfg.secure ? {} : { requireTLS: true }),
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: cfg.connectionTimeoutMs ?? 15_000,
    greetingTimeout: cfg.greetingTimeoutMs ?? 15_000,
    socketTimeout: cfg.socketTimeoutMs ?? 60_000,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: !allowSelfSigned(cfg.host) },
  };
}

function secretForms(cfg: SmtpConfig): string[] {
  if (!cfg.pass) return [];
  return [
    cfg.pass,
    Buffer.from(cfg.pass, "utf8").toString("base64"),
    Buffer.from(`\u0000${cfg.user}\u0000${cfg.pass}`, "utf8").toString("base64"),
  ].sort((a, b) => b.length - a.length);
}

function scrub(err: unknown, secrets: string[]): unknown {
  if (typeof err !== "object" || err === null || secrets.length === 0) return err;
  const e = err as Record<string, unknown>;
  for (const key of ["message", "stack", "response"]) {
    const value = e[key];
    if (typeof value === "string") e[key] = secrets.reduce((out, s) => out.split(s).join(REDACTED), value);
  }
  return err;
}

interface StageTracker {
  dataAccepted: boolean;
}

function stageLogger(tracker: StageTracker) {
  const observe = (entry: { tnx?: string } | undefined, message: unknown) => {
    if (entry?.tnx === "server" && typeof message === "string" && DATA_ACCEPTED.test(message)) tracker.dataAccepted = true;
    if (entry?.tnx === "message") tracker.dataAccepted = true;
  };
  return { debug: observe, info: observe, trace() {}, warn() {}, error() {}, fatal() {} };
}

function tagDataStage(err: unknown, tracker: StageTracker): unknown {
  if (!tracker.dataAccepted || typeof err !== "object" || err === null) return err;
  const e = err as { command?: unknown };
  if (e.command === undefined || e.command === "CONN") e.command = "DATA";
  return err;
}

export function buildTransport(cfg: SmtpConfig): MailTransport {
  const tracker: StageTracker = { dataAccepted: false };
  const secrets = secretForms(cfg);
  const transporter = nodemailer.createTransport({
    ...transportOptions(cfg),
    logger: stageLogger(tracker),
    transactionLog: true,
  });
  return {
    async send(msg) {
      tracker.dataAccepted = false;
      try {
        const info = await transporter.sendMail({
          from: msg.from,
          to: msg.to,
          ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          headers: msg.headers,
        });
        return { messageId: String(info.messageId ?? ""), response: String(info.response ?? "") };
      } catch (err) {
        throw scrub(tagDataStage(err, tracker), secrets);
      }
    },
    async verify() {
      try {
        await transporter.verify();
      } catch (err) {
        throw scrub(err, secrets);
      }
    },
    close() {
      transporter.close();
    },
  };
}

export async function verifyTransport(cfg: SmtpConfig): Promise<void> {
  const transport = buildTransport(cfg);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}
