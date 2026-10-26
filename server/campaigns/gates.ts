import type { DatabaseSync } from "node:sqlite";
import { validateSchedule, type Schedule } from "../domain/schedule.ts";
import { emailDomain } from "../domain/email.ts";
import type { Gate, GateKey, GatesResult, Health, HealthItem, SettingsView } from "../http/contract.ts";
import { getList } from "../import/lists.ts";
import { senderGaps } from "../settings/store.ts";
import { analyzeTemplate } from "../templates/analysis.ts";
import { linksPass } from "../templates/linkCheck.ts";
import { getTemplate, type TemplateRecord } from "../templates/store.ts";
import { getCampaign, listContactCount, type CampaignRecord } from "./store.ts";
import { campaignCounts } from "./view.ts";

export const BULK_SENDER_DAILY_CAP = 5000;

export interface GateContext {
  health: Health;
  settings: SettingsView;
}

function gate(key: GateKey, ok: boolean, okMessage: string, failMessage: string): Gate {
  return { key, ok, message: ok ? okMessage : failMessage };
}

function listGate(db: DatabaseSync, c: CampaignRecord): Gate {
  const status = getList(db, c.list_id)?.status;
  const why =
    status === undefined
      ? "The list no longer exists; create a new campaign."
      : status === "importing"
        ? "The list is still importing; wait for it to finish."
        : "The list import failed; upload the list again and create a new campaign.";
  return gate("list_ready", status === "ready", "The list is imported and ready.", why);
}

function recipientsGate(db: DatabaseSync, c: CampaignRecord): Gate {
  const counts = campaignCounts(db, c.id);
  const expected = listContactCount(db, c.list_id);
  if (counts.total < expected) {
    return gate(
      "has_recipients",
      false,
      "",
      `This campaign was not fully created (${counts.total} of ${expected} recipients); delete it and create it again.`,
    );
  }
  const waiting = counts.pending + counts.retry;
  return gate(
    "has_recipients",
    waiting > 0,
    `${waiting} recipient${waiting === 1 ? "" : "s"} waiting to be sent.`,
    "Nobody is left to send to in this campaign.",
  );
}

function senderGates(settings: SettingsView): Gate[] {
  const gaps = new Set(senderGaps(settings));
  return [
    gate("from_email", !gaps.has("from_email"), "The from address is set.", "Set a valid from address in Sender settings."),
    gate(
      "postal_address",
      !gaps.has("postal_address"),
      "The postal address is set.",
      "Set your postal address in Sender settings; every email must include it.",
    ),
    gate(
      "unsub_mailbox",
      !gaps.has("unsub_mailbox"),
      "The unsubscribe mailbox is set.",
      "Set a valid unsubscribe mailbox in Sender settings.",
    ),
  ];
}

function healthGate(key: "smtp_verified" | "dns_ok", item: HealthItem, okMessage: string, notRun: string, failed: string): Gate {
  const message = item.status === "unknown" ? notRun : `${failed}: ${item.detail}`;
  return gate(key, item.status === "ok", okMessage, message);
}

function templateGates(t: TemplateRecord | null, c: CampaignRecord): Gate[] {
  if (!t) {
    const gone = "The template no longer exists; create a new campaign.";
    return (["variables_resolved", "no_malformed_tags", "links_ok", "test_send_ok"] as const).map((key) => gate(key, false, "", gone));
  }
  const analysis = analyzeTemplate(t);
  const missing = [...analysis.validation.unresolved, ...analysis.validation.needsFallback].map((n) => `{{${n}}}`);
  const malformedParts = analysis.malformed.map((m) => m.part).join(", ");
  const broken = t.linkCheck?.links.filter((l) => !l.ok && !l.acknowledged).length ?? 0;
  const linksMessage = !t.linkCheck
    ? "Run the link check on the template."
    : t.linkCheck.version !== t.version
      ? "The template changed since the last link check; run it again."
      : `${broken} link${broken === 1 ? " is" : "s are"} broken or not checkable: fix or acknowledge ${broken === 1 ? "it" : "them"}.`;
  const testMessage =
    c.template_version !== t.version
      ? "The template changed after this campaign was created; delete the campaign and create a new one."
      : "Send a test of the current template version to your test inboxes.";
  return [
    gate(
      "variables_resolved",
      analysis.validation.ok,
      "Every template variable has a value or a fallback.",
      `Map a column or add a fallback for: ${missing.join(", ")}.`,
    ),
    gate("no_malformed_tags", analysis.malformed.length === 0, "No malformed {{tags}}.", `Fix the malformed tags in the ${malformedParts}.`),
    gate("links_ok", linksPass(t.linkCheck, t.version), "Every link works or is acknowledged.", linksMessage),
    gate(
      "test_send_ok",
      t.lastTestOkVersion === t.version && c.template_version === t.version,
      "A test send of this template version succeeded.",
      testMessage,
    ),
  ];
}

function parseSchedule(json: string): Schedule | null {
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Schedule) : null;
  } catch {
    return null;
  }
}

function scheduleGate(c: CampaignRecord, settings: SettingsView): Gate {
  const schedule = parseSchedule(c.schedule_json);
  let errors: string[];
  try {
    errors = schedule ? validateSchedule(schedule) : ["The saved schedule is unreadable; set the schedule again."];
  } catch {
    errors = ["The saved schedule is incomplete; set the schedule again."];
  }
  if (errors.length === 0 && schedule && schedule.dailyCap > BULK_SENDER_DAILY_CAP && !settings.publicBaseUrl?.startsWith("https://")) {
    errors.push(
      `A daily cap above ${BULK_SENDER_DAILY_CAP.toLocaleString("en-US")} needs one-click unsubscribe (Gmail/Yahoo bulk-sender rule): ` +
        "set an https public unsubscribe URL in Sender settings, or lower the cap.",
    );
  }
  return gate("schedule_valid", errors.length === 0, "The schedule is valid.", errors.join(" "));
}

export function evaluateGates(db: DatabaseSync, campaignId: number, ctx: GateContext): GatesResult | null {
  const c = getCampaign(db, campaignId);
  if (!c) return null;
  const domain = emailDomain(ctx.settings.fromEmail) || "your from domain";
  const gates: Gate[] = [
    listGate(db, c),
    recipientsGate(db, c),
    ...senderGates(ctx.settings),
    healthGate(
      "smtp_verified",
      ctx.health.smtp,
      "The SMTP connection test passed.",
      "Run Test connection in Sender settings.",
      "The last SMTP test failed; fix the settings and test again",
    ),
    healthGate(
      "dns_ok",
      ctx.health.dns,
      `SPF, DKIM and DMARC pass for ${domain}.`,
      "Run Check DNS in Sender settings.",
      `The DNS check for ${domain} failed; fix the records and check again`,
    ),
    ...templateGates(getTemplate(db, c.template_id), c),
    scheduleGate(c, ctx.settings),
  ];
  return { ok: gates.every((g) => g.ok), gates };
}
