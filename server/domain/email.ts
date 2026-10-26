import { domainToASCII } from "node:url";

export const ROLE_LOCAL_PARTS: ReadonlySet<string> = new Set([
  "info",
  "sales",
  "admin",
  "support",
  "noreply",
  "no-reply",
  "postmaster",
  "abuse",
  "webmaster",
  "contact",
  "hello",
  "office",
]);

const MAX_ADDRESS_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;

const MAILTO_PREFIX = /^mailto:/i;
const DISPLAY_FORM = /<([^<>]*)>$/;
const QUOTED = /^(["'])(.*)\1$/s;

const PRAGMATIC = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TOP_LEVEL_DOMAIN = /^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/;

export function normalizeEmail(raw: string): string {
  let email = raw.trim().replace(MAILTO_PREFIX, "");
  const display = DISPLAY_FORM.exec(email);
  if (display) email = display[1].trim().replace(MAILTO_PREFIX, "");
  const quoted = QUOTED.exec(email);
  if (quoted) email = quoted[2].trim();
  return email.toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (email.length > MAX_ADDRESS_LENGTH || CONTROL_CHARS.test(email) || !PRAGMATIC.test(email)) {
    return false;
  }
  const at = email.indexOf("@");
  const local = email.slice(0, at);
  if (local.length > MAX_LOCAL_LENGTH || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return false;
  }
  const domain = domainToASCII(email.slice(at + 1));
  if (!domain || local.length + 1 + domain.length > MAX_ADDRESS_LENGTH) return false;
  const labels = domain.split(".");
  return labels.every((label) => DOMAIN_LABEL.test(label)) && TOP_LEVEL_DOMAIN.test(labels[labels.length - 1]);
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1);
}

export function isRoleAddress(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const local = email.slice(0, at).split("+", 1)[0];
  return ROLE_LOCAL_PARTS.has(local.toLowerCase());
}
