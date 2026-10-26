const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timezone, f);
  }
  return f;
}

export function isValidTimezone(timezone: string): boolean {
  if (!timezone) return false;
  try {
    formatter(timezone);
    return true;
  } catch (err) {
    if (err instanceof RangeError) return false;
    throw err;
  }
}

function wallClockMs(ms: number, timezone: string): number {
  const p: Record<string, number> = {};
  for (const { type, value } of formatter(timezone).formatToParts(ms)) {
    if (type !== "literal") p[type] = Number(value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

function offsetAt(ms: number, timezone: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  return wallClockMs(whole, timezone) - whole;
}

function firstInstantWithOffset(lo: number, hi: number, offset: number, timezone: string): number {
  let low = Math.floor(lo / 1000);
  let high = Math.ceil(hi / 1000);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (offsetAt(mid * 1000, timezone) === offset) high = mid;
    else low = mid + 1;
  }
  return high * 1000;
}

export function zonedToUtc(localDate: string, minutes: number, timezone: string): Date {
  const wall = dateKeyToUtcMs(localDate) + minutes * 60_000;
  const offsets = [...new Set([offsetAt(wall - DAY_MS, timezone), offsetAt(wall + DAY_MS, timezone)])];
  const valid = offsets.map((o) => wall - o).filter((t) => offsetAt(t, timezone) === wall - t);
  if (valid.length > 0) return new Date(Math.min(...valid));
  const later = Math.max(...offsets);
  const candidates = offsets.map((o) => wall - o);
  return new Date(firstInstantWithOffset(Math.min(...candidates), Math.max(...candidates), later, timezone));
}

export function localDateKey(instant: Date, timezone: string): string {
  return new Date(wallClockMs(instant.getTime(), timezone)).toISOString().slice(0, 10);
}

function dateKeyToUtcMs(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(key: string, days: number): string {
  return new Date(dateKeyToUtcMs(key) + days * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(key: string): number {
  return new Date(dateKeyToUtcMs(key)).getUTCDay();
}
