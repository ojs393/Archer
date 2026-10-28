import { useEffect } from "react";
import type { AnalyticsBucket } from "@/lib/types";
import { cn } from "@/lib/utils";

export type DashboardRange =
  | "30m"
  | "1h"
  | "6h"
  | "12h"
  | "24h"
  | "7d"
  | "30d"
  | "90d"
  | "180d"
  | "365d";

export type TimeseriesQuery = { bucket: AnalyticsBucket; days?: number; hours?: number };

type RangeDef = {
  id: DashboardRange;
  label: string;
  windowMs: number;
  query: TimeseriesQuery;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** All supported windows, shortest → longest. */
export const RANGE_DEFS: readonly RangeDef[] = [
  { id: "30m", label: "30m", windowMs: 0.5 * HOUR, query: { bucket: "minute", hours: 0.5 } },
  { id: "1h", label: "1h", windowMs: HOUR, query: { bucket: "minute", hours: 1 } },
  { id: "6h", label: "6h", windowMs: 6 * HOUR, query: { bucket: "hour", hours: 6 } },
  { id: "12h", label: "12h", windowMs: 12 * HOUR, query: { bucket: "hour", hours: 12 } },
  { id: "24h", label: "24h", windowMs: DAY, query: { bucket: "hour", hours: 24 } },
  { id: "7d", label: "7d", windowMs: 7 * DAY, query: { bucket: "day", days: 7 } },
  { id: "30d", label: "30d", windowMs: 30 * DAY, query: { bucket: "day", days: 30 } },
  { id: "90d", label: "3mo", windowMs: 90 * DAY, query: { bucket: "day", days: 90 } },
  { id: "180d", label: "6mo", windowMs: 180 * DAY, query: { bucket: "day", days: 180 } },
  { id: "365d", label: "12mo", windowMs: 365 * DAY, query: { bucket: "day", days: 365 } },
] as const;

export const DASHBOARD_RANGES: readonly DashboardRange[] = RANGE_DEFS.map((r) => r.id);

/** Map a dashboard range to timeseries query params. */
export function rangeToQuery(range: DashboardRange): TimeseriesQuery {
  const def = RANGE_DEFS.find((r) => r.id === range);
  if (!def) return { bucket: "hour", hours: 24 };
  return def.query;
}

/**
 * A range is available when we have enough retained history to put something
 * meaningful in the window (at least 20% of the lookback, or any data for ≤6h).
 */
export function isRangeAvailable(range: DashboardRange, coverageFrom: string | null, now = new Date()): boolean {
  if (!coverageFrom) return false;
  const from = Date.parse(coverageFrom);
  if (!Number.isFinite(from)) return false;
  const historyMs = Math.max(0, now.getTime() - from);
  const def = RANGE_DEFS.find((r) => r.id === range);
  if (!def) return false;
  if (def.windowMs <= 6 * HOUR) return historyMs > 0;
  return historyMs >= def.windowMs * 0.2;
}

export function availableRanges(coverageFrom: string | null, now = new Date()): DashboardRange[] {
  return DASHBOARD_RANGES.filter((r) => isRangeAvailable(r, coverageFrom, now));
}

/** Prefer current selection if still available; else nearest shorter available; else first. */
export function pickAvailableRange(
  preferred: DashboardRange,
  coverageFrom: string | null,
  now = new Date(),
): DashboardRange {
  const ok = availableRanges(coverageFrom, now);
  if (ok.length === 0) return preferred;
  if (ok.includes(preferred)) return preferred;
  const prefIdx = DASHBOARD_RANGES.indexOf(preferred);
  for (let i = prefIdx; i >= 0; i--) {
    if (ok.includes(DASHBOARD_RANGES[i])) return DASHBOARD_RANGES[i];
  }
  return ok[0];
}

export function TimeRange({
  value,
  onChange,
  coverageFrom,
}: {
  value: DashboardRange;
  onChange: (range: DashboardRange) => void;
  /**
   * Oldest retained event — ranges longer than available history are hidden.
   * `undefined` = still loading (show full set); `null` = no history yet.
   */
  coverageFrom?: string | null;
}) {
  const loading = coverageFrom === undefined;
  const available = loading ? DASHBOARD_RANGES : availableRanges(coverageFrom);
  const visible = loading ? DASHBOARD_RANGES : available;

  useEffect(() => {
    if (coverageFrom === undefined || coverageFrom === null) return;
    const next = pickAvailableRange(value, coverageFrom);
    if (next !== value) onChange(next);
  }, [coverageFrom, value, onChange]);

  if (!loading && visible.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        No activity history yet
      </p>
    );
  }

  return (
    <div
      className="inline-flex max-w-full flex-wrap gap-0.5 rounded-md border border-border p-0.5"
      role="group"
      aria-label="Time range"
    >
      {RANGE_DEFS.filter((r) => visible.includes(r.id)).map((r) => (
        <button
          key={r.id}
          type="button"
          disabled={loading}
          className={cn(
            "rounded px-2 py-1 text-xs font-medium tabular transition-colors",
            value === r.id ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
            loading ? "opacity-60" : null,
          )}
          aria-pressed={value === r.id}
          onClick={() => onChange(r.id)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
