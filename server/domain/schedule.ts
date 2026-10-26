import { addDays, isValidTimezone, localDateKey, weekdayOf, zonedToUtc } from "./zonedTime.ts";

export { localDateKey };

export interface Schedule {
  timezone: string;
  sendDays: number[];
  startTime: string;
  endTime: string;
  dailyCap: number;
  warmup: boolean;
  delaySeconds: number;
}

export const WARMUP_START = 50;

const MAX_CAP = 100_000;
const MAX_DELAY_SECONDS = 3600;
const ESTIMATE_HORIZON_DAYS = 3650;
const NEXT_SEND_SEARCH_DAYS = 14;
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function defaultSchedule(timezone: string): Schedule {
  return {
    timezone,
    sendDays: [1, 2, 3, 4, 5],
    startTime: "09:00",
    endTime: "17:00",
    dailyCap: 2000,
    warmup: true,
    delaySeconds: 10,
  };
}

function minutesOf(time: string): number | null {
  const match = HH_MM.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function isIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function validateSchedule(s: Schedule): string[] {
  const errors: string[] = [];
  if (!isValidTimezone(s.timezone)) errors.push(`Unknown timezone "${s.timezone}".`);
  if (s.sendDays.length === 0) errors.push("Pick at least one send day.");
  else if (!s.sendDays.every((d) => isIntegerInRange(d, 0, 6))) errors.push("Send days must be 0 (Sunday) to 6 (Saturday).");
  else if (new Set(s.sendDays).size !== s.sendDays.length) errors.push("Send days must not repeat.");
  const start = minutesOf(s.startTime);
  const end = minutesOf(s.endTime);
  if (start === null) errors.push("Start time must be HH:MM (24-hour).");
  if (end === null) errors.push("End time must be HH:MM (24-hour).");
  if (start !== null && end !== null && end <= start) errors.push("End time must be after start time.");
  if (!isIntegerInRange(s.dailyCap, 1, MAX_CAP)) errors.push(`Daily cap must be a whole number from 1 to ${MAX_CAP}.`);
  if (!isIntegerInRange(s.delaySeconds, 1, MAX_DELAY_SECONDS)) {
    errors.push(`Delay must be a whole number of seconds from 1 to ${MAX_DELAY_SECONDS}.`);
  }
  return errors;
}

export function warmupQuota(sendDayIndex: number, cap: number, warmup: boolean): number {
  return warmup ? Math.min(cap, WARMUP_START * 2 ** sendDayIndex) : cap;
}

export function windowBounds(localDate: string, s: Schedule): { start: Date; end: Date } {
  return {
    start: zonedToUtc(localDate, minutesOf(s.startTime) ?? 0, s.timezone),
    end: zonedToUtc(localDate, minutesOf(s.endTime) ?? 0, s.timezone),
  };
}

function isSendDay(localDate: string, s: Schedule): boolean {
  return s.sendDays.includes(weekdayOf(localDate));
}

export function isWithinWindow(instant: Date, s: Schedule): boolean {
  const today = localDateKey(instant, s.timezone);
  if (!isSendDay(today, s)) return false;
  const { start, end } = windowBounds(today, s);
  return instant >= start && instant < end;
}

export class NoSendWindowError extends Error {}

export function nextSendTime(now: Date, s: Schedule): Date {
  let date = localDateKey(now, s.timezone);
  for (let i = 0; i < NEXT_SEND_SEARCH_DAYS; i++, date = addDays(date, 1)) {
    if (!isSendDay(date, s)) continue;
    const { start, end } = windowBounds(date, s);
    if (now >= end || end <= start) continue;
    return now >= start ? new Date(now.getTime()) : start;
  }
  throw new NoSendWindowError(`No send window within ${NEXT_SEND_SEARCH_DAYS} days.`);
}

export interface EstimateInput {
  remaining: number;
  schedule: Schedule;
  now: Date;
  sentToday?: number;
  /**
   * When sentToday > 0: the warm-up step today has consumed, even if today's window is closed.
   * When sentToday is 0/absent: the warm-up step of the next send day.
   */
  sendDayIndex?: number;
}

export interface EstimateDay {
  date: string;
  count: number;
}

export interface Estimate {
  perDay: EstimateDay[];
  completionDate: string | null;
  totalDays: number;
  perDayCapacityNote?: string;
}

export function estimateSchedule(input: EstimateInput): Estimate {
  const { schedule: s, now } = input;
  if (input.remaining <= 0) return { perDay: [], completionDate: null, totalDays: 0 };
  const sentToday = input.sentToday ?? 0;
  const perDay: EstimateDay[] = [];
  let left = input.remaining;
  let index = input.sendDayIndex ?? 0;
  let date = localDateKey(now, s.timezone);

  for (let i = 0; i < ESTIMATE_HORIZON_DAYS && left > 0; i++, date = addDays(date, 1)) {
    if (!isSendDay(date, s)) continue;
    const { start, end } = windowBounds(date, s);
    const isToday = i === 0;
    const stepUsedToday = isToday && sentToday > 0;
    const quota = warmupQuota(index, s.dailyCap, s.warmup) - (isToday ? sentToday : 0);
    if (stepUsedToday) index++;
    if (isToday && now >= end) continue;
    const from = isToday && now > start ? now : start;
    const windowSeconds = Math.max(0, (end.getTime() - from.getTime()) / 1000);
    const count = Math.min(Math.max(0, quota), Math.floor(windowSeconds / s.delaySeconds), left);
    if (count > 0) {
      perDay.push({ date, count });
      left -= count;
      if (!stepUsedToday) index++;
    }
  }

  if (left > 0) {
    const perDayCapacityNote =
      perDay.length === 0
        ? "Nothing can be sent with this schedule. Check the send days, window and delay."
        : `Not finished within ${ESTIMATE_HORIZON_DAYS} days at this daily capacity; ${left} would remain.`;
    return { perDay, completionDate: null, totalDays: perDay.length, perDayCapacityNote };
  }
  return { perDay, completionDate: perDay[perDay.length - 1].date, totalDays: perDay.length };
}
