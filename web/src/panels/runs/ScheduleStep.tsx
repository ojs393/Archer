import { FieldRow } from "@/components/FieldRow";
import { InfoHint } from "@/components/ui/InfoHint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/format";
import { useEstimate } from "@/lib/queries/campaigns";
import type { Schedule } from "@/lib/types";
import { type ScheduleMode } from "./scheduleMode";

export function ScheduleStep({
  mode,
  onModeChange,
  schedule,
  onScheduleChange,
  remaining,
}: {
  mode: ScheduleMode;
  onModeChange: (mode: ScheduleMode) => void;
  schedule: Schedule;
  onScheduleChange: (patch: Partial<Schedule>) => void;
  remaining: number;
}) {
  const estimate = useEstimate(remaining, schedule, remaining > 0);
  const data = estimate.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1">
          <Label htmlFor="run-schedule-mode">Mode</Label>
          <InfoHint label="About warm-up">
            Warm-up starts at a low daily volume and doubles each send day up to your cap. Use it on new domains or after a long pause.
          </InfoHint>
        </div>
        <Select value={mode} onValueChange={(v) => onModeChange(v as ScheduleMode)}>
          <SelectTrigger id="run-schedule-mode" aria-label="Schedule mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asap">As soon as possible</SelectItem>
            <SelectItem value="window">Send window</SelectItem>
            <SelectItem value="warmup">Warm-up</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode !== "asap" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldRow id="run-start" label="Start time">
            <Input
              type="time"
              value={schedule.startTime}
              onChange={(e) => onScheduleChange({ startTime: e.target.value || "09:00" })}
            />
          </FieldRow>
          <FieldRow id="run-end" label="End time">
            <Input
              type="time"
              value={schedule.endTime}
              onChange={(e) => onScheduleChange({ endTime: e.target.value || "17:00" })}
            />
          </FieldRow>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <FieldRow id="run-tz" label="Timezone">
          <Input value={schedule.timezone} onChange={(e) => onScheduleChange({ timezone: e.target.value })} />
        </FieldRow>
        <FieldRow id="run-cap" label="Daily cap">
          <Input
            type="number"
            min={1}
            value={schedule.dailyCap}
            onChange={(e) => onScheduleChange({ dailyCap: Math.max(1, Number(e.target.value) || 1) })}
          />
        </FieldRow>
      </div>

      {mode === "warmup" ? (
        <p className="text-xs text-secondary-foreground">
          Warm-up uses an automatic daily ramp (50, 100, 200, …) up to your cap. The estimate below shows the projected days.
        </p>
      ) : null}

      <div className="rounded-md border border-border p-3 text-sm">
        <p className="text-xs font-medium text-muted-foreground">Estimate</p>
        {estimate.isPending ? (
          <p className="mt-1 text-secondary-foreground">Calculating…</p>
        ) : estimate.isError ? (
          <p className="mt-1 text-destructive">Could not estimate this schedule.</p>
        ) : (
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Recipients</dt>
              <dd className="font-medium tabular">{formatNumber(remaining)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Days</dt>
              <dd className="font-medium tabular">{formatNumber(data?.totalDays ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Finish by</dt>
              <dd className="font-medium">{data?.completionDate ?? "—"}</dd>
            </div>
          </dl>
        )}
        {data?.perDayCapacityNote ? <p className="mt-2 text-xs text-secondary-foreground">{data.perDayCapacityNote}</p> : null}
        {mode === "warmup" && data && data.perDay.length > 0 ? (
          <p className="mt-2 text-xs text-secondary-foreground">
            Daily caps: {data.perDay.slice(0, 8).map((d) => d.count).join(", ")}
            {data.perDay.length > 8 ? "…" : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
