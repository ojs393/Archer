import { createHmac, timingSafeEqual } from "node:crypto";

const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 1024;
const MAC_CONTEXT = "mamadirect-unsub-v1:";
const TOKEN_SHAPE = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

interface LinkOptions {
  mailbox: string;
  publicBaseUrl?: string | null;
  token: string;
}

function mac(email: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(MAC_CONTEXT + email, "utf8").digest();
}

export function signToken(email: string, secret: string): string {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error(`Unsubscribe secret must be at least ${MIN_SECRET_LENGTH} characters`);
  if (email.length === 0) throw new Error("Cannot sign an empty email");
  return Buffer.from(email, "utf8").toString("base64url") + "." + mac(email, secret).toString("base64url");
}

export function verifyToken(token: string, secret: string): string | null {
  if (secret.length < MIN_SECRET_LENGTH || token.length > MAX_TOKEN_LENGTH) return null;
  const match = TOKEN_SHAPE.exec(token);
  if (!match) return null;
  const [, emailPart, macPart] = match;
  const email = Buffer.from(emailPart, "base64url").toString("utf8");
  if (Buffer.from(email, "utf8").toString("base64url") !== emailPart) return null;
  const given = Buffer.from(macPart, "base64url");
  if (given.toString("base64url") !== macPart) return null;
  const expected = mac(email, secret);
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
  return publicBaseUrl;
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
