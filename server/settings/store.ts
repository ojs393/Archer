import type { DatabaseSync } from "node:sqlite";
import { deleteSetting, getSetting, setSetting } from "../db/settings.ts";
import { transaction } from "../db/transaction.ts";
import type { Provider, SettingsUpdate, SettingsView } from "../http/contract.ts";
import { isSafeEmail } from "../http/fields.ts";
import type { SmtpConfig } from "../send/transport.ts";
import type { SenderConfig } from "../send/worker.ts";
import { isSesRegion, SES_SMTP_PORT, sesSmtpHost } from "./sesRegions.ts";

type Env = Record<string, string | undefined>;

const DEFAULT_TIMEZONE = "UTC";
const DEFAULT_SMTP_PORT = 587;

const TEXT_KEYS = {
  operatorName: "operator_name",
  organization: "organization",
  fromName: "from_name",
  fromEmail: "from_email",
  postalAddress: "postal_address",
  unsubMailbox: "unsub_mailbox",
  timezone: "timezone",
} as const;

const NULLABLE_KEYS = {
  replyTo: "reply_to",
  publicBaseUrl: "public_base_url",
  dkimSelector: "dkim_selector",
} as const;

const SMTP_KEYS = { host: "smtp_host", port: "smtp_port", secure: "smtp_secure", user: "smtp_user" } as const;
const PROVIDER_KEY = "provider";
const SES_REGION_KEY = "ses_region";
const SETUP_COMPLETED_KEY = "setup_completed_at";

function parseProvider(value: string | undefined): Provider {
  return value === "smtp" ? "smtp" : "ses";
}

function parseRegion(value: string | undefined): string | null {
  return value && isSesRegion(value) ? value : null;
}

function parseInboxes(json: string | undefined): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function parsePort(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_SMTP_PORT;
}

export function getSettingsView(db: DatabaseSync, env: Env): SettingsView {
  const get = (key: string) => getSetting(db, key);
  return {
    provider: parseProvider(get(PROVIDER_KEY)),
    sesRegion: parseRegion(get(SES_REGION_KEY)),
    operatorName: get(TEXT_KEYS.operatorName) ?? "",
    organization: get(TEXT_KEYS.organization) ?? "",
    setupCompletedAt: get(SETUP_COMPLETED_KEY) || null,
    fromName: get(TEXT_KEYS.fromName) ?? "",
    fromEmail: get(TEXT_KEYS.fromEmail) ?? "",
    replyTo: get(NULLABLE_KEYS.replyTo) || null,
    postalAddress: get(TEXT_KEYS.postalAddress) ?? "",
    unsubMailbox: get(TEXT_KEYS.unsubMailbox) ?? "",
    publicBaseUrl: get(NULLABLE_KEYS.publicBaseUrl) || null,
    dkimSelector: get(NULLABLE_KEYS.dkimSelector) || null,
    timezone: get(TEXT_KEYS.timezone) || DEFAULT_TIMEZONE,
    testInboxes: parseInboxes(get("test_inboxes")),
    smtp: {
      host: get(SMTP_KEYS.host) ?? "",
      port: parsePort(get(SMTP_KEYS.port)),
      secure: get(SMTP_KEYS.secure) === "1",
      user: get(SMTP_KEYS.user) ?? "",
      passSet: Boolean(env.SMTP_PASS),
    },
  };
}

export interface SettingsChange {
  smtpChanged: boolean;
  dnsChanged: boolean;
}

export function updateSettings(db: DatabaseSync, patch: SettingsUpdate): SettingsChange {
  const change: SettingsChange = { smtpChanged: false, dnsChanged: false };
  transaction(db, () => {
    const write = (key: string, value: string | null) => {
      const before = getSetting(db, key) ?? null;
      if (before === value) return false;
      if (value === null) deleteSetting(db, key);
      else setSetting(db, key, value);
      return true;
    };
    for (const [field, key] of Object.entries(TEXT_KEYS) as [keyof typeof TEXT_KEYS, string][]) {
      const value = patch[field];
      if (value !== undefined && write(key, value) && field === "fromEmail") change.dnsChanged = true;
    }
    for (const [field, key] of Object.entries(NULLABLE_KEYS) as [keyof typeof NULLABLE_KEYS, string][]) {
      const value = patch[field];
      if (value !== undefined && write(key, value) && field === "dkimSelector") change.dnsChanged = true;
    }
    if (patch.testInboxes !== undefined) write("test_inboxes", JSON.stringify(patch.testInboxes));
    if (patch.provider !== undefined && write(PROVIDER_KEY, patch.provider)) change.smtpChanged = true;
    if (patch.sesRegion !== undefined && write(SES_REGION_KEY, patch.sesRegion)) change.smtpChanged = true;
    const smtp = patch.smtp;
    if (smtp) {
      const wrote = [
        smtp.host !== undefined && write(SMTP_KEYS.host, smtp.host),
        smtp.port !== undefined && write(SMTP_KEYS.port, String(smtp.port)),
        smtp.secure !== undefined && write(SMTP_KEYS.secure, smtp.secure ? "1" : "0"),
        smtp.user !== undefined && write(SMTP_KEYS.user, smtp.user),
      ];
      if (wrote.some(Boolean)) change.smtpChanged = true;
    }
  });
  return change;
}

export type SenderField = "from_email" | "postal_address" | "unsub_mailbox";

export function senderGaps(s: SettingsView): SenderField[] {
  const gaps: SenderField[] = [];
  if (!isSafeEmail(s.fromEmail)) gaps.push("from_email");
  if (!s.postalAddress.trim()) gaps.push("postal_address");
  if (!isSafeEmail(s.unsubMailbox)) gaps.push("unsub_mailbox");
  return gaps;
}

export function setSetupCompletedAt(db: DatabaseSync, at: string | null): void {
  if (at === null) deleteSetting(db, SETUP_COMPLETED_KEY);
  else setSetting(db, SETUP_COMPLETED_KEY, at);
}

export function smtpConfigFor(s: SettingsView, env: Env): SmtpConfig {
  const pass = env.SMTP_PASS ?? "";
  if (s.provider === "ses") {
    // Stored host/port/secure belong to the generic SMTP provider; with no region there is no endpoint yet.
    const host = s.sesRegion ? sesSmtpHost(s.sesRegion) : "";
    return { host, port: SES_SMTP_PORT, secure: false, user: s.smtp.user, pass };
  }
  return { host: s.smtp.host, port: s.smtp.port, secure: s.smtp.secure, user: s.smtp.user, pass };
}

export function getSmtpConfig(db: DatabaseSync, env: Env): SmtpConfig {
  return smtpConfigFor(getSettingsView(db, env), env);
}

export function getSenderConfig(db: DatabaseSync, env: Env): SenderConfig {
  const s = getSettingsView(db, env);
  return {
    smtp: smtpConfigFor(s, env),
    fromName: s.fromName,
    fromEmail: s.fromEmail,
    replyTo: s.replyTo,
    postalAddress: s.postalAddress,
    unsubMailbox: s.unsubMailbox,
    publicBaseUrl: s.publicBaseUrl,
    unsubSecret: env.UNSUB_SECRET ?? "",
  };
}
