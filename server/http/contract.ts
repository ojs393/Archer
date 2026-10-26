import { z } from "zod";
import type { SuppressionRow } from "../db/suppression.ts";
import type { Estimate, Schedule } from "../domain/schedule.ts";
import type { ImportCounts } from "../import/csv.ts";
import type { ListRow } from "../import/lists.ts";
import type { CampaignStatus } from "../send/sendState.ts";
import {
  dkimSelector,
  email,
  emailOrEmpty,
  formBoolean,
  httpsBaseUrl,
  multiLine,
  nullableEmail,
  port,
  singleLine,
  smtpHost,
  smtpPassword,
  timezone,
} from "./fields.ts";

export type { DnsAuthResult as DnsCheckResult } from "../dns/check.ts";
export type { ImportCounts } from "../import/csv.ts";
export type { ListRow } from "../import/lists.ts";
export type { SuppressionRow } from "../db/suppression.ts";
export type { WorkerEvent } from "../send/worker.ts";
export type { Estimate, Schedule } from "../domain/schedule.ts";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface HealthItem {
  status: "ok" | "fail" | "unknown";
  detail: string;
  checkedAt: string | null;
}

export interface Health {
  smtp: HealthItem;
  dns: HealthItem;
  network: HealthItem;
  worker: HealthItem & { heartbeatAgeMs: number | null; loopRunning: boolean };
}

export interface SettingsView {
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  postalAddress: string;
  unsubMailbox: string;
  publicBaseUrl: string | null;
  dkimSelector: string | null;
  timezone: string;
  testInboxes: string[];
  smtp: { host: string; port: number; secure: boolean; user: string; passSet: boolean };
}

export interface ImportEvent {
  listId: number;
  phase: "parsing" | "checking_domains" | "done" | "failed";
  rowsProcessed?: number;
  domainsChecked?: number;
  domainsTotal?: number;
  breakerTripped?: boolean;
  counts?: ImportCounts;
  error?: string;
}

export interface CampaignCounts {
  pending: number;
  sending: number;
  sent: number;
  retry: number;
  failed: number;
  uncertain: number;
  skipped_suppressed: number;
  total: number;
}

export interface CampaignView {
  id: number;
  listId: number;
  templateId: number;
  templateVersion: number;
  status: CampaignStatus;
  pauseReason: string | null;
  /** null when the stored schedule JSON is unreadable; the estimate is then empty with a note. */
  schedule: Schedule | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  counts: CampaignCounts;
  estimate: Estimate;
  stats: { sentLastHour: number; rejectionRate: number; sample: number };
}

export interface StatusSnapshot {
  campaign: CampaignView | null;
  worker: { status: string | null; heartbeatAgeMs: number | null; loopRunning: boolean; inFlight: boolean };
}

export type GateKey =
  | "list_ready"
  | "has_recipients"
  | "from_email"
  | "postal_address"
  | "unsub_mailbox"
  | "smtp_verified"
  | "dns_ok"
  | "variables_resolved"
  | "no_malformed_tags"
  | "links_ok"
  | "test_send_ok"
  | "schedule_valid";

export interface Gate {
  key: GateKey;
  ok: boolean;
  message: string;
}

export interface SmtpTestResult {
  ok: boolean;
  message: string;
}

export interface ListPreview {
  delimiter: string;
  headers: string[];
  headerless: boolean;
  rows: string[][];
  emailColumn: number;
}

export type ListDetail = ListRow & { columns: string[] };

export interface SuppressionPage {
  rows: SuppressionRow[];
  total: number;
}

export const settingsUpdateSchema = z
  .strictObject({
    fromName: singleLine().optional(),
    fromEmail: emailOrEmpty.optional(),
    replyTo: nullableEmail.optional(),
    postalAddress: multiLine().optional(),
    unsubMailbox: emailOrEmpty.optional(),
    publicBaseUrl: httpsBaseUrl.optional(),
    dkimSelector: dkimSelector.optional(),
    timezone: timezone.optional(),
    testInboxes: z
      .array(email)
      .max(10, "At most 10 test inboxes")
      .transform((list) => [...new Set(list)])
      .optional(),
    smtp: z
      .strictObject({
        host: smtpHost.optional(),
        port: port.optional(),
        secure: z.boolean().optional(),
        user: singleLine().optional(),
        pass: smtpPassword.optional(),
        clearPass: z.literal(true).optional(),
        passSet: z.boolean().optional(),
      })
      .refine((s) => !(s.pass !== undefined && s.clearPass), "Send either a new password or clearPass, not both")
      .optional(),
  });

export type SettingsUpdate = z.output<typeof settingsUpdateSchema>;

const emailColumnField = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v): string | number | undefined => {
    if (!v) return undefined;
    const index = /^#(\d{1,5})$/.exec(v);
    return index ? Number(index[1]) : v;
  });

export const listUploadFieldsSchema = z.strictObject({
  name: singleLine({ min: 1, max: 200 }),
  sourceLabel: singleLine({ min: 1 }),
  consentText: multiLine({ min: 1, max: 2000 }),
  consentConfirmed: z.literal("true", { error: "Confirm that every address on this list consented to receive your email" }),
  excludeRoles: formBoolean(true),
  emailColumn: emailColumnField,
  checkDomains: formBoolean(true),
});

export type ListUploadFields = z.output<typeof listUploadFieldsSchema>;

export const idParamSchema = z.strictObject({ id: z.coerce.number().int().positive() });

export const suppressionQuerySchema = z.strictObject({
  search: z.string().max(320).optional(),
  limit: z.coerce.number().int().min(0).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const suppressionAddSchema = z.strictObject({
  email,
  reason: z.literal("manual").optional(),
});

export const suppressionParamSchema = z.strictObject({ email: z.string().min(1).max(320) });
