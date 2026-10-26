import type { Schedule } from "@/lib/types";

export type ScheduleMode = "asap" | "window" | "warmup";

export function detectMode(schedule: Schedule): ScheduleMode {
  if (schedule.warmup) return "warmup";
  if (schedule.startTime === "00:00" && schedule.endTime === "23:59" && schedule.sendDays.length === 7) return "asap";
  return "window";
}

export function buildSchedule(
  mode: ScheduleMode,
  base: {
    timezone: string;
    startTime: string;
    endTime: string;
    dailyCap: number;
    delaySeconds: number;
    sendDays?: number[];
  },
): Schedule {
  const weekdays = [1, 2, 3, 4, 5];
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  if (mode === "asap") {
    return {
      timezone: base.timezone,
      sendDays: allDays,
      startTime: "00:00",
      endTime: "23:59",
      dailyCap: base.dailyCap,
      warmup: false,
      delaySeconds: base.delaySeconds,
    };
  }
  return {
    timezone: base.timezone,
    sendDays: base.sendDays ?? weekdays,
    startTime: base.startTime,
    endTime: base.endTime,
    dailyCap: base.dailyCap,
    warmup: mode === "warmup",
    delaySeconds: base.delaySeconds,
  };
}

export function defaultLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
