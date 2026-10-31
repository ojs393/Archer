/** Turn a persisted campaign event into operator-facing columns. */

const EMAIL_RE = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;

export type ActivityTone = "default" | "ok" | "warn" | "danger" | "info";

export type FormattedActivity = {
  action: string;
  recipient: string | null;
  detail: string;
  tone: ActivityTone;
};

const ACTION: Record<string, { action: string; tone: ActivityTone }> = {
  status: { action: "Status", tone: "info" },
  sent: { action: "Sent", tone: "ok" },
  retry: { action: "Retry", tone: "warn" },
  failed: { action: "Failed", tone: "danger" },
  suppressed: { action: "Suppressed", tone: "warn" },
  skipped: { action: "Skipped", tone: "warn" },
  uncertain: { action: "Uncertain", tone: "warn" },
  error: { action: "Error", tone: "danger" },
  chain: { action: "Chain", tone: "info" },
  requeue: { action: "Requeued", tone: "info" },
};

function stripPrefix(message: string, prefixes: string[]): string {
  for (const p of prefixes) {
    if (message.startsWith(p)) return message.slice(p.length).trim();
  }
  return message;
}

export function formatActivityEvent(type: string, message: string): FormattedActivity {
  const meta = ACTION[type] ?? { action: type || "Event", tone: "default" as ActivityTone };
  const emailMatch = message.match(EMAIL_RE);
  const recipient = emailMatch?.[1] ?? null;

  let detail = message.trim();
  if (type === "sent") {
    detail = recipient ? "Accepted by SMTP" : stripPrefix(message, ["Sent to "]);
  } else if (type === "status") {
    detail = stripPrefix(message, ["Status: "]);
  } else if (type === "retry" && recipient) {
    detail = message.replace(new RegExp(`^Retry\\s+\\d+/\\d+\\s+for\\s+${recipient.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:?\\s*`, "i"), "").trim() || message;
  } else if ((type === "failed" || type === "suppressed" || type === "skipped" || type === "uncertain") && recipient) {
    const escaped = recipient.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    detail = message
      .replace(new RegExp(`^(Failed|Suppressed|Skipped|Uncertain)\\s+${escaped}\\s*:?\\s*`, "i"), "")
      .trim() || message;
  }

  if (recipient && detail.includes(recipient) && type === "sent") {
    detail = "Accepted by SMTP";
  }

  return { action: meta.action, recipient, detail: detail || "—", tone: meta.tone };
}
