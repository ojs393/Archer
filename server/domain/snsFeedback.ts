import { createVerify, X509Certificate } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { addSuppression, type SuppressionReason } from "../db/suppression.ts";
import type { Logger } from "../logger.ts";
import { normalizeEmail } from "./email.ts";

export const SNS_ROUTE = "/sns";
export const SNS_BODY_LIMIT = 256 * 1024;

const CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/i;

export interface SnsEnvelope {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
  UnsubscribeURL?: string;
}

export type FetchCert = (url: string) => Promise<string>;
export type ConfirmSubscription = (url: string) => Promise<void>;

function isHttpsAmazonUrl(raw: string, hostPattern: RegExp): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && hostPattern.test(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isSnsCertUrl(url: string): boolean {
  return isHttpsAmazonUrl(url, CERT_HOST);
}

export function isSnsSubscribeUrl(url: string): boolean {
  return isHttpsAmazonUrl(url, CERT_HOST);
}

function field(envelope: SnsEnvelope, key: string): string | undefined {
  switch (key) {
    case "Message":
      return envelope.Message;
    case "MessageId":
      return envelope.MessageId;
    case "Subject":
      return envelope.Subject;
    case "SubscribeURL":
      return envelope.SubscribeURL;
    case "Timestamp":
      return envelope.Timestamp;
    case "Token":
      return envelope.Token;
    case "TopicArn":
      return envelope.TopicArn;
    case "Type":
      return envelope.Type;
    default:
      return undefined;
  }
}

function signingString(envelope: SnsEnvelope): string | null {
  const fields: string[] =
    envelope.Type === "SubscriptionConfirmation" || envelope.Type === "UnsubscribeConfirmation"
      ? ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]
      : envelope.Subject !== undefined
        ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
        : ["Message", "MessageId", "Timestamp", "TopicArn", "Type"];
  let out = "";
  for (const key of fields) {
    const value = field(envelope, key);
    if (value === undefined) return null;
    out += `${key}\n${value}\n`;
  }
  return out;
}

export async function defaultFetchCert(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SNS cert fetch failed: ${res.status}`);
  return res.text();
}

export async function defaultConfirmSubscription(url: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SNS subscription confirm failed: ${res.status}`);
}

/** Verify SNS signature (SignatureVersion 1 = SHA1, 2 = SHA256). */
export async function verifySnsSignature(envelope: SnsEnvelope, fetchCert: FetchCert = defaultFetchCert): Promise<boolean> {
  if (!isSnsCertUrl(envelope.SigningCertURL)) return false;
  if (envelope.SignatureVersion !== "1" && envelope.SignatureVersion !== "2") return false;
  const payload = signingString(envelope);
  if (!payload) return false;
  let pem: string;
  try {
    pem = await fetchCert(envelope.SigningCertURL);
  } catch {
    return false;
  }
  try {
    // Touch the cert so a garbage PEM fails early with a clear path.
    new X509Certificate(pem);
    const verifier = createVerify(envelope.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1");
    verifier.update(payload, "utf8");
    return verifier.verify(pem, envelope.Signature, "base64");
  } catch {
    return false;
  }
}

function parseEnvelope(body: unknown): SnsEnvelope | null {
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (typeof o.Type !== "string" || typeof o.MessageId !== "string") return null;
  if (typeof o.Message !== "string" || typeof o.Timestamp !== "string") return null;
  if (typeof o.TopicArn !== "string" || typeof o.Signature !== "string") return null;
  if (typeof o.SignatureVersion !== "string" || typeof o.SigningCertURL !== "string") return null;
  const envelope: SnsEnvelope = {
    Type: o.Type,
    MessageId: o.MessageId,
    TopicArn: o.TopicArn,
    Message: o.Message,
    Timestamp: o.Timestamp,
    SignatureVersion: o.SignatureVersion,
    Signature: o.Signature,
    SigningCertURL: o.SigningCertURL,
  };
  if (typeof o.Subject === "string") envelope.Subject = o.Subject;
  if (typeof o.SubscribeURL === "string") envelope.SubscribeURL = o.SubscribeURL;
  if (typeof o.Token === "string") envelope.Token = o.Token;
  if (typeof o.UnsubscribeURL === "string") envelope.UnsubscribeURL = o.UnsubscribeURL;
  return envelope;
}

interface SesRecipient {
  emailAddress?: string;
}

function recipientsOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const addr = (item as SesRecipient).emailAddress;
    if (typeof addr === "string" && addr.trim()) out.push(addr);
  }
  return out;
}

function recordFeedback(
  db: DatabaseSync,
  kind: "bounce" | "complaint",
  email: string,
  detail: string | null,
  messageId: string | null,
  reason: SuppressionReason,
): boolean {
  const normalized = normalizeEmail(email);
  db.prepare("INSERT INTO feedback_events (kind, email, detail, message_id) VALUES (?, ?, ?, ?)").run(
    kind,
    normalized,
    detail,
    messageId,
  );
  return addSuppression(db, normalized, reason);
}

/** Apply a SES notification JSON string. Returns how many addresses were newly suppressed. */
export function applySesNotification(db: DatabaseSync, messageJson: string, log: Logger): number {
  let notification: Record<string, unknown>;
  try {
    notification = JSON.parse(messageJson) as Record<string, unknown>;
  } catch {
    log.warn("SNS notification Message was not JSON; ignored");
    return 0;
  }
  const type = notification.notificationType;
  const mail = notification.mail as { messageId?: string } | undefined;
  const messageId = typeof mail?.messageId === "string" ? mail.messageId : null;
  let added = 0;

  if (type === "Bounce") {
    const bounce = notification.bounce as { bounceType?: string; bouncedRecipients?: unknown } | undefined;
    if (bounce?.bounceType !== "Permanent") return 0;
    for (const email of recipientsOf(bounce.bouncedRecipients)) {
      if (recordFeedback(db, "bounce", email, "Permanent", messageId, "hard_bounce")) {
        added++;
        log.info(`SES permanent bounce; suppressed ${normalizeEmail(email)}`);
      }
    }
    return added;
  }

  if (type === "Complaint") {
    const complaint = notification.complaint as { complainedRecipients?: unknown; complaintFeedbackType?: string } | undefined;
    const detail = typeof complaint?.complaintFeedbackType === "string" ? complaint.complaintFeedbackType : null;
    for (const email of recipientsOf(complaint?.complainedRecipients)) {
      if (recordFeedback(db, "complaint", email, detail, messageId, "complaint")) {
        added++;
        log.info(`SES complaint; suppressed ${normalizeEmail(email)}`);
      }
    }
    return added;
  }

  return 0;
}

export interface HandleSnsResult {
  status: number;
  body: string;
}

/**
 * Process one SNS HTTP POST body. Signature must already be verified (or skipped in tests).
 * Auto-confirms SubscriptionConfirmation by GETting SubscribeURL.
 */
export async function handleSnsEnvelope(
  db: DatabaseSync,
  body: unknown,
  log: Logger,
  opts: {
    verify?: (envelope: SnsEnvelope) => Promise<boolean>;
    confirm?: ConfirmSubscription;
  } = {},
): Promise<HandleSnsResult> {
  const envelope = parseEnvelope(body);
  if (!envelope) return { status: 400, body: "bad sns payload" };

  const verify = opts.verify ?? ((e: SnsEnvelope) => verifySnsSignature(e));
  if (!(await verify(envelope))) return { status: 403, body: "invalid sns signature" };

  if (envelope.Type === "SubscriptionConfirmation") {
    const url = envelope.SubscribeURL;
    if (!url || !isSnsSubscribeUrl(url)) return { status: 400, body: "bad subscribe url" };
    try {
      await (opts.confirm ?? defaultConfirmSubscription)(url);
      log.info("SNS subscription confirmed");
      return { status: 200, body: "confirmed" };
    } catch (err) {
      log.warn("SNS subscription confirm failed:", err);
      return { status: 502, body: "confirm failed" };
    }
  }

  if (envelope.Type === "UnsubscribeConfirmation") {
    log.info("SNS unsubscribe confirmation received");
    return { status: 200, body: "ok" };
  }

  if (envelope.Type === "Notification") {
    applySesNotification(db, envelope.Message, log);
    return { status: 200, body: "ok" };
  }

  return { status: 400, body: "unsupported sns type" };
}

export function feedbackCounts(db: DatabaseSync): { complaints: number; bounces: number } {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'complaint' THEN 1 ELSE 0 END), 0) AS complaints,
         COALESCE(SUM(CASE WHEN kind = 'bounce' THEN 1 ELSE 0 END), 0) AS bounces
       FROM feedback_events`,
    )
    .get() as { complaints: number; bounces: number };
  return { complaints: Number(row.complaints), bounces: Number(row.bounces) };
}
