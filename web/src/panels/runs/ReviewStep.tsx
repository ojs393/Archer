import { useEffect, useState } from "react";
import { formatNumber } from "@/lib/format";
import { previewTemplate } from "@/lib/queries/templates";
import type { Gate, Health, ListRow, Schedule, SettingsView, TemplatePreview, TemplateSummary } from "@/lib/types";
import type { ScheduleMode } from "./scheduleMode";

function gateFromSettings(settings: SettingsView | undefined, health: Health | undefined): Gate[] {
  return [
    {
      key: "from_name",
      ok: Boolean(settings?.fromName?.trim()),
      message: settings?.fromName?.trim() ? `From name: ${settings.fromName}` : "Set a From name in Settings",
    },
    {
      key: "from_email",
      ok: Boolean(settings?.fromEmail),
      message: settings?.fromEmail ? `From: ${settings.fromEmail}` : "Set a From address in Settings",
    },
    {
      key: "postal_address",
      ok: Boolean(settings?.postalAddress?.trim()),
      message: settings?.postalAddress?.trim() ? "Postal address set" : "Set a postal address in Settings",
    },
    {
      key: "unsub_mailbox",
      ok: Boolean(settings?.unsubMailbox),
      message: settings?.unsubMailbox ? `Unsubscribe: ${settings.unsubMailbox}` : "Set an unsubscribe mailbox in Settings",
    },
    {
      key: "smtp_verified",
      ok: Boolean(settings?.smtp.host && settings.smtp.user && settings.smtp.passSet) && health?.smtp.status !== "fail",
      message:
        settings?.smtp.host && settings.smtp.user && settings.smtp.passSet
          ? health?.smtp.status === "ok"
            ? "SMTP configured and verified"
            : "SMTP configured (run a test in Settings if needed)"
          : "Configure SMTP in Settings",
    },
  ];
}

export function ReviewStep({
  list,
  template,
  mode,
  schedule,
  settings,
  health,
  launchGates,
  startError,
}: {
  list: ListRow | null;
  template: TemplateSummary | null;
  mode: ScheduleMode;
  schedule: Schedule;
  settings: SettingsView | undefined;
  health: Health | undefined;
  launchGates: Gate[] | null;
  startError: string | null;
}) {
  const checklist = launchGates ?? gateFromSettings(settings, health);
  const modeLabel = mode === "asap" ? "As soon as possible" : mode === "warmup" ? "Warm-up" : "Send window";
  const [samples, setSamples] = useState<TemplatePreview[]>([]);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!list || !template) {
        setSamples([]);
        setSampleError(null);
        return;
      }
      setSampleLoading(true);
      setSampleError(null);
      try {
        const out: TemplatePreview[] = [];
        let after: number | undefined;
        for (let i = 0; i < 3; i++) {
          const preview = await previewTemplate(template.id, {
            listId: list.id,
            pick: i === 0 ? "first" : "next",
            ...(after !== undefined ? { afterContactId: after } : {}),
          });
          if (preview.contactId == null && i > 0) break;
          if (out.some((p) => p.contactId === preview.contactId && preview.contactId != null)) break;
          out.push(preview);
          if (preview.contactId == null) break;
          after = preview.contactId;
        }
        if (!cancelled) setSamples(out);
      } catch (err) {
        if (!cancelled) setSampleError(err instanceof Error ? err.message : "Could not preview contacts");
      } finally {
        if (!cancelled) setSampleLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [list, template]);

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Audience</dt>
          <dd className="font-medium">{list ? `${list.name} (${formatNumber(list.valid_count)})` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Template</dt>
          <dd className="font-medium">{template?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Schedule</dt>
          <dd className="font-medium">
            {modeLabel}: {schedule.startTime}–{schedule.endTime} {schedule.timezone}; cap {schedule.dailyCap}/day
          </dd>
        </div>
      </dl>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Launch checks</p>
        <ul className="flex flex-col gap-1.5 text-sm">
          {checklist.map((g) => (
            <li key={g.key} className={g.ok ? "text-foreground" : "text-destructive"}>
              <span className="mr-1 font-medium">{g.ok ? "Pass" : "Fail"}</span>
              {g.message}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Sample of real recipients</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Subjects rendered from your list — confirm names and merge tags look right before starting.
        </p>
        {sampleLoading ? <p className="text-sm text-muted-foreground">Loading samples…</p> : null}
        {sampleError ? (
          <p role="alert" className="text-sm text-destructive">
            {sampleError}
          </p>
        ) : null}
        {!sampleLoading && !sampleError && samples.length === 0 ? (
          <p className="text-sm text-muted-foreground">Pick an audience and template to preview merges.</p>
        ) : null}
        {samples.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {samples.map((s, i) => (
              <li key={`${s.contactId ?? i}-${s.email}`} className="rounded-md border border-border px-3 py-2 text-sm">
                <p className="truncate font-medium text-foreground">{s.email}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">Subject · {s.subject}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {startError ? (
        <p role="alert" className="text-sm text-destructive">
          {startError}
        </p>
      ) : null}
    </div>
  );
}
