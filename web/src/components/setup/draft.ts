import type { Provider, SettingsUpdate, SettingsView } from "@/lib/types";

/** Local wizard form state. Password stays write-only; empty means leave unchanged. */
export interface SetupDraft {
  operatorName: string;
  organization: string;
  provider: Provider;
  sesRegion: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  clearPass: boolean;
  fromEmail: string;
  dkimSelector: string;
  fromName: string;
  replyTo: string;
  unsubMailbox: string;
  postalAddress: string;
  publicBaseUrl: string;
  testInboxes: string[];
}

export function draftFromSettings(s: SettingsView): SetupDraft {
  return {
    operatorName: s.operatorName,
    organization: s.organization,
    provider: s.provider,
    sesRegion: s.sesRegion ?? "",
    smtpHost: s.smtp.host,
    smtpPort: s.smtp.port || 587,
    smtpSecure: s.smtp.secure,
    smtpUser: s.smtp.user,
    smtpPass: "",
    clearPass: false,
    fromEmail: s.fromEmail,
    dkimSelector: s.dkimSelector ?? "",
    fromName: s.fromName,
    replyTo: s.replyTo ?? "",
    unsubMailbox: s.unsubMailbox,
    postalAddress: s.postalAddress,
    publicBaseUrl: s.publicBaseUrl ?? "",
    testInboxes: [...s.testInboxes],
  };
}

/** Fingerprint of SMTP credentials that invalidate a prior Health.smtp ok. */
export function smtpFingerprint(d: SetupDraft): string {
  return [
    d.provider,
    d.sesRegion,
    d.smtpHost,
    String(d.smtpPort),
    String(d.smtpSecure),
    d.smtpUser,
    d.smtpPass ? "new" : d.clearPass ? "cleared" : "unchanged",
  ].join("|");
}

export function patchOperator(d: SetupDraft): SettingsUpdate {
  return { operatorName: d.operatorName.trim(), organization: d.organization.trim() };
}

export function patchProvider(d: SetupDraft): SettingsUpdate {
  const smtp: NonNullable<SettingsUpdate["smtp"]> = { user: d.smtpUser.trim() };
  if (d.provider === "smtp") {
    smtp.host = d.smtpHost.trim();
    smtp.port = d.smtpPort;
    smtp.secure = d.smtpSecure;
  }
  if (d.clearPass) smtp.clearPass = true;
  else if (d.smtpPass) smtp.pass = d.smtpPass;
  return {
    provider: d.provider,
    sesRegion: d.provider === "ses" ? d.sesRegion || null : null,
    smtp,
  };
}

export function patchDomain(d: SetupDraft): SettingsUpdate {
  return {
    fromEmail: d.fromEmail.trim(),
    dkimSelector: d.dkimSelector.trim() || null,
  };
}

export function patchAddresses(d: SetupDraft): SettingsUpdate {
  return {
    fromName: d.fromName.trim(),
    fromEmail: d.fromEmail.trim(),
    replyTo: d.replyTo.trim() || null,
    unsubMailbox: d.unsubMailbox.trim(),
    postalAddress: d.postalAddress,
    publicBaseUrl: d.publicBaseUrl.trim() || null,
  };
}

export function patchFinish(d: SetupDraft): SettingsUpdate {
  return { testInboxes: d.testInboxes };
}

const EMAIL_RE = /^[^\s<>?,;:"()[\]\\]+@[^\s<>?,;:"()[\]\\]+\.[^\s<>?,;:"()[\]\\]+$/;

export function isEmail(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.length > 0 && v.length <= 254 && EMAIL_RE.test(v);
}
