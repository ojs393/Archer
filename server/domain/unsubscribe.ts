import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { normalizeEmail } from "./email.ts";

const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 1024;
/** Opaque token MAC (id only — email never appears in the URL). */
const MAC_CONTEXT_V2 = "archer-unsub-v2:";
/** Legacy email-in-token MAC — still verified so older mail keeps working. */
const MAC_CONTEXT_V1 = "archer-unsub-v1:";
const TOKEN_SHAPE = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

interface LinkOptions {
  mailbox: string;
  publicBaseUrl?: string | null;
  token: string;
}

function macV2(id: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(MAC_CONTEXT_V2 + id, "utf8").digest();
}

function macV1(email: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(MAC_CONTEXT_V1 + email, "utf8").digest();
}

function parseParts(token: string, secret: string): { left: string; given: Buffer } | null {
  if (typeof token !== "string" || typeof secret !== "string") return null;
  if (secret.length < MIN_SECRET_LENGTH || token.length > MAX_TOKEN_LENGTH) return null;
  const match = TOKEN_SHAPE.exec(token);
  if (!match) return null;
  const [, left, macPart] = match;
  const given = Buffer.from(macPart, "base64url");
  if (given.toString("base64url") !== macPart) return null;
  return { left, given };
}

/** Issue a new opaque unsubscribe token. The email is stored server-side only. */
export function issueToken(db: DatabaseSync, email: string, secret: string): string {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error(`Unsubscribe secret must be at least ${MIN_SECRET_LENGTH} characters`);
  if (email.length === 0) throw new Error("Cannot sign an empty email");
  const id = randomBytes(18).toString("base64url");
  db.prepare("INSERT INTO unsubscribe_tokens (id, email) VALUES (?, ?)").run(id, normalizeEmail(email));
  return `${id}.${macV2(id, secret).toString("base64url")}`;
}

/** Resolve a token to an email. Accepts opaque v2 tokens and legacy email-in-token links. */
export function resolveToken(db: DatabaseSync, token: string, secret: string): string | null {
  const parts = parseParts(token, secret);
  if (!parts) return null;
  const { left, given } = parts;

  const expectedV2 = macV2(left, secret);
  if (given.length === expectedV2.length && timingSafeEqual(given, expectedV2)) {
    const row = db.prepare("SELECT email FROM unsubscribe_tokens WHERE id = ?").get(left) as { email: string } | undefined;
    return row?.email ?? null;
  }

  // Legacy: base64url(email).mac — keep working for mail already in the wild.
  let email: string;
  try {
    email = Buffer.from(left, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (Buffer.from(email, "utf8").toString("base64url") !== left) return null;
  const expectedV1 = macV1(email, secret);
  if (given.length !== expectedV1.length || !timingSafeEqual(given, expectedV1)) return null;
  return email;
}

/** @deprecated Prefer issueToken; kept for tests that build legacy tokens. */
export function signToken(email: string, secret: string): string {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error(`Unsubscribe secret must be at least ${MIN_SECRET_LENGTH} characters`);
  if (email.length === 0) throw new Error("Cannot sign an empty email");
  return Buffer.from(email, "utf8").toString("base64url") + "." + macV1(email, secret).toString("base64url");
}

/** @deprecated Prefer resolveToken with a database. */
export function verifyToken(token: string, secret: string): string | null {
  const parts = parseParts(token, secret);
  if (!parts) return null;
  const { left, given } = parts;
  let email: string;
  try {
    email = Buffer.from(left, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (Buffer.from(email, "utf8").toString("base64url") !== left) return null;
  const expected = macV1(email, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return email;
}

function httpsBase(publicBaseUrl: string | null | undefined): string | null {
  if (!publicBaseUrl) return null;
  let url: URL;
  try {
    url = new URL(publicBaseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.search || url.hash) return null;
  return url.href;
}

export function unsubscribeMailto(mailbox: string, token: string): string {
  return `mailto:${mailbox}?subject=unsubscribe%20${token}`;
}

export function unsubscribeHttpsUrl(publicBaseUrl: string, token: string): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}/u/${token}`;
}

export function unsubscribeLink({ mailbox, publicBaseUrl, token }: LinkOptions): string {
  const base = httpsBase(publicBaseUrl);
  return base ? unsubscribeHttpsUrl(base, token) : unsubscribeMailto(mailbox, token);
}

export function listUnsubscribeHeaders({ mailbox, publicBaseUrl, token }: LinkOptions): Record<string, string> {
  const mailto = `<${unsubscribeMailto(mailbox, token)}>`;
  const base = httpsBase(publicBaseUrl);
  if (!base) return { "List-Unsubscribe": mailto };
  return {
    "List-Unsubscribe": `<${unsubscribeHttpsUrl(base, token)}>, ${mailto}`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
