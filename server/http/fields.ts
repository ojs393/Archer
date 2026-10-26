import { z } from "zod";
import { isValidEmail, normalizeEmail } from "../domain/email.ts";
import { isValidTimezone } from "../domain/zonedTime.ts";
import { isStorableEnvValue } from "../settings/envFile.ts";
import { isSesRegion } from "../settings/sesRegions.ts";

const LINE_BREAK = /[\r\n]/;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
// Characters that are legal in some RFC 5322 forms but would let a value break out of a header or mailto URL.
const HEADER_UNSAFE_IN_EMAIL = /[\s<>?,;:"()[\]\\]/;
const HOSTNAME = /^[A-Za-z0-9._:-]+$/;
const DKIM_SELECTOR = /^[a-z0-9](?:[a-z0-9_-]{0,62})(?:\.[a-z0-9_-]{1,63})*$/i;
const TEXT_MAX = 500;

export function singleLine(opts: { min?: number; max?: number } = {}) {
  return z
    .string()
    .trim()
    .min(opts.min ?? 0)
    .max(opts.max ?? TEXT_MAX)
    .refine((v) => !LINE_BREAK.test(v) && !CONTROL.test(v), "Must be a single line without control characters");
}

export function multiLine(opts: { min?: number; max?: number } = {}) {
  return z
    .string()
    .transform((v) => v.replace(/\r\n?/g, "\n").trim())
    .pipe(
      z
        .string()
        .min(opts.min ?? 0)
        .max(opts.max ?? TEXT_MAX)
        .refine((v) => !CONTROL.test(v), "Must not contain control characters"),
    );
}

export function isSafeEmail(value: string): boolean {
  return isValidEmail(value) && !HEADER_UNSAFE_IN_EMAIL.test(value);
}

export const email = z
  .string()
  .max(320)
  .transform(normalizeEmail)
  .refine(isSafeEmail, "Enter a valid email address");

export const emailOrEmpty = z.union([z.string().trim().length(0), email]);

export const nullableEmail = z
  .union([z.null(), z.string().trim().length(0), email])
  .transform((v) => (v ? v : null));

export const httpsBaseUrl = z
  .union([z.null(), z.string().trim().max(TEXT_MAX)])
  .transform((v, ctx) => {
    if (!v) return null;
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a full URL starting with https://" });
      return z.NEVER;
    }
    const problem =
      url.protocol !== "https:"
        ? "The public unsubscribe URL must start with https://"
        : url.username || url.password
          ? "The URL must not contain a username or password"
          : /[?#]/.test(v)
            ? "The URL must not contain a query (?) or fragment (#)"
            : /[\s<>"'`]/.test(v) || CONTROL.test(v)
              ? "The URL contains characters that are not allowed"
              : null;
    if (problem) {
      ctx.addIssue({ code: "custom", message: problem });
      return z.NEVER;
    }
    return url.href.replace(/,/g, "%2C").replace(/\/+$/, "");
  });

export const dkimSelector = z
  .union([z.null(), z.string().trim().max(253)])
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || DKIM_SELECTOR.test(v), "A DKIM selector looks like \"s1\" or \"google\"");

export const timezone = z.string().trim().refine(isValidTimezone, "Unknown timezone; use an IANA name like Europe/London");

export const smtpHost = z
  .string()
  .trim()
  .max(253)
  .refine((v) => v === "" || HOSTNAME.test(v), "Enter a host name like smtp.example.com");

export const port = z.number().int().min(1).max(65535);

export const sesRegion = z
  .union([z.null(), z.string().trim().max(40)])
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isSesRegion(v), "Choose one of the listed Amazon SES regions, like us-east-1");

export const smtpPassword = z
  .string()
  .min(1)
  .max(1024)
  .refine((v) => !/[\r\n\u0000]/.test(v), "The password must not contain line breaks")
  .refine(isStorableEnvValue, "This password mixes quote characters in a way the .env file cannot store; change it");

export const formBoolean = (fallback: boolean) =>
  z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === "true"));
