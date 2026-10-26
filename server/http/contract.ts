import { z } from "zod";
import type { SuppressionRow } from "../db/suppression.ts";
import { validateSchedule, type Estimate, type Schedule } from "../domain/schedule.ts";
import { BUILTIN_KEYS, type TemplatePart, type TemplateVariable, type VariableMap } from "../domain/template.ts";
import type { LinkCheck } from "../templates/linkCheck.ts";
import type { SesRegion } from "../settings/sesRegions.ts";
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
  sesRegion,
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
export type { TemplatePart, TemplateVariable, VariableMap, VariableSource } from "../domain/template.ts";
export type { LinkCheck, LinkResult } from "../templates/linkCheck.ts";
export type { SesRegion } from "../settings/sesRegions.ts";

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

export const PROVIDERS = ["ses", "smtp"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface SettingsView {
  provider: Provider;
  /** Used only when provider is "ses": the SMTP endpoint is then email-smtp.<region>.amazonaws.com:587 (STARTTLS). */
  sesRegion: string | null;
  operatorName: string;
  organization: string;
  setupCompletedAt: string | null;
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

export interface SetupSteps {
  operator: boolean;
  provider: boolean;
  domain: boolean;
  addresses: boolean;
  testInboxes: boolean;
}

export interface SetupView {
  complete: boolean;
  completedAt: string | null;
  steps: SetupSteps;
  regions: readonly SesRegion[];
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
    provider: z.enum(PROVIDERS).optional(),
    sesRegion: sesRegion.optional(),
    operatorName: singleLine({ max: 120 }).optional(),
    organization: singleLine({ max: 120 }).optional(),
    setupCompletedAt: z.union([z.null(), z.string().max(64)]).optional(),
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

export interface TemplateSummary {
  id: number;
  name: string;
  version: number;
  updatedAt: string;
}

export interface TemplateAnalysis {
  variables: TemplateVariable[];
  malformed: { part: TemplatePart; problems: { index: number; snippet: string }[] }[];
  validation: { ok: boolean; unresolved: string[]; needsFallback: string[] };
  hasComplianceTags: boolean;
}

export interface TemplateView {
  id: number;
  name: string;
  version: number;
  subject: string;
  html: string;
  text: string | null;
  createdAt: string;
  updatedAt: string;
  variableMap: VariableMap;
  analysis: TemplateAnalysis;
  linkCheck: LinkCheck | null;
  testedOk: boolean;
}

export interface TemplatePreview {
  contactId: number | null;
  email: string;
  subject: string;
  html: string;
  text: string;
}

export interface TestSendResult {
  results: { to: string; ok: boolean; messageId: string | null; error: string | null }[];
}

export interface GatesResult {
  ok: boolean;
  gates: Gate[];
}

export interface UncertainPage {
  rows: { contactId: number; email: string; lastError: string | null; updatedAt: string }[];
  total: number;
}

export interface CampaignEventsPage {
  rows: { id: number; type: string; message: string; createdAt: string }[];
}

export const TEMPLATE_MAX_BYTES = 2 * 1024 * 1024;

const templateName = singleLine({ min: 1, max: 200 });
const templateSubject = singleLine({ min: 1, max: 998 });
const templateBody = z.string().min(1, "Must not be empty").max(TEMPLATE_MAX_BYTES, "Must be 2 MB or smaller");
const positiveId = z.number().int().positive();

export const variableSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("column"), column: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal("builtin"), key: z.enum(BUILTIN_KEYS) }),
  z.strictObject({ kind: z.literal("fixed"), value: z.string().max(1000) }),
]);

export const variableMapSchema = z
  .record(z.string().regex(/^[a-zA-Z0-9_]{1,100}$/, "Variable names use letters, digits and _"), variableSourceSchema)
  .refine((m) => Object.keys(m).length <= 500, "At most 500 variables");

export const templateCreateSchema = z
  .strictObject({ name: templateName, subject: templateSubject, html: templateBody.optional(), text: templateBody.optional() })
  .refine((t) => t.html !== undefined || t.text !== undefined, { message: "Provide html or text", path: ["html"] });

export const templateUploadFieldsSchema = z.strictObject({ name: templateName, subject: templateSubject });

export const templateUpdateSchema = z.strictObject({
  name: templateName.optional(),
  subject: templateSubject.optional(),
  html: templateBody.optional(),
  text: templateBody.nullable().optional(),
  variableMap: variableMapSchema.optional(),
});

export type TemplateUpdate = z.output<typeof templateUpdateSchema>;

export const templatePreviewSchema = z.strictObject({
  listId: positiveId.optional(),
  pick: z.enum(["first", "next", "random"]).default("first"),
  afterContactId: z.number().int().nonnegative().optional(),
});

export const linkAckSchema = z.strictObject({ url: z.string().min(1).max(4096) });

export const testSendSchema = z.strictObject({
  to: z.array(email).min(1).max(10).optional(),
  listId: positiveId.optional(),
});

export const scheduleSchema = z
  .strictObject({
    timezone: z.string().max(100),
    sendDays: z.array(z.number().int()).max(7),
    startTime: z.string().max(5),
    endTime: z.string().max(5),
    dailyCap: z.number().int(),
    warmup: z.boolean(),
    delaySeconds: z.number().int(),
  })
  .superRefine((s, ctx) => {
    for (const message of validateSchedule(s)) ctx.addIssue({ code: "custom", message });
  });

export const estimateSchema = z.strictObject({
  remaining: z.number().int().min(0).max(100_000_000),
  schedule: scheduleSchema,
});

export const campaignCreateSchema = z.strictObject({ listId: positiveId, templateId: positiveId, schedule: scheduleSchema });

export const scheduleUpdateSchema = z.strictObject({ schedule: scheduleSchema });

export const pageQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(0).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const requeueSchema = z.strictObject({ contactIds: z.array(positiveId).min(1).max(10_000).optional() });

export const campaignEventsQuerySchema = z.strictObject({
  type: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  beforeId: z.coerce.number().int().positive().optional(),
});

export interface AnalyticsTotals {
  recipients: number;
  sent: number;
  failed: number;
  suppressed: number;
  retry: number;
  uncertain: number;
  skipped: number;
  pending: number;
}

export interface AnalyticsSummary {
  totals: AnalyticsTotals;
  rates: { deliveryRate: number; bounceRate: number; rejectionRate: number };
  lastSendAt: string | null;
}

export type AnalyticsBucket = "hour" | "day";

export interface AnalyticsPoint {
  t: string;
  sent: number;
  failed: number;
  suppressed: number;
  retry: number;
  uncertain: number;
}

export interface AnalyticsTimeseries {
  bucket: AnalyticsBucket;
  /** Oldest kept event in scope: buckets before it have no data (not real zeros). null when there are no events. */
  coverageFrom: string | null;
  points: AnalyticsPoint[];
}

export type AnalyticsErrorKind = "failed" | "suppressed" | "retry" | "uncertain";

export interface AnalyticsErrors {
  coverageFrom: string | null;
  rows: { kind: AnalyticsErrorKind; message: string; count: number; lastAt: string }[];
}

export interface AnalyticsRun {
  id: number;
  name: string;
  status: CampaignStatus;
  recipients: number;
  sent: number;
  failed: number;
  suppressed: number;
  uncertain: number;
  deliveryRate: number;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AnalyticsRuns {
  rows: AnalyticsRun[];
}

export interface AnalyticsFeedback {
  available: false;
  reason: string;
  guidance: string[];
}

export const ANALYTICS_MAX_DAYS = 90;

const analyticsCampaignId = z.coerce.number().int().positive().optional();

export const analyticsScopeSchema = z.strictObject({ campaignId: analyticsCampaignId });

export const analyticsTimeseriesQuerySchema = z
  .strictObject({
    campaignId: analyticsCampaignId,
    bucket: z.enum(["hour", "day"]).default("hour"),
    days: z.coerce.number().int().min(1).max(ANALYTICS_MAX_DAYS).optional(),
  })
  .transform((q) => ({ ...q, days: q.days ?? (q.bucket === "hour" ? 2 : 30) }));

export const analyticsErrorsQuerySchema = z.strictObject({
  campaignId: analyticsCampaignId,
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export interface DesktopLauncherResult {
  ok: true;
  path: string;
}
