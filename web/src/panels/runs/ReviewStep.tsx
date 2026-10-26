import { formatNumber } from "@/lib/format";
import type { Gate, Health, ListRow, Schedule, SettingsView, TemplateSummary } from "@/lib/types";
import type { ScheduleMode } from "./scheduleMode";

function gateFromSettings(settings: SettingsView | undefined, health: Health | undefined): Gate[] {
  return [
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
  list, template, mode, schedule, settings, health, launchGates, startError,
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

      {startError ? (
        <p role="alert" className="text-sm text-destructive">
          {startError}
        </p>
      ) : null}
    </div>
  );
}
