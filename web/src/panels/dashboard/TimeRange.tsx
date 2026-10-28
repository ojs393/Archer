import { useEffect, useRef } from "react";
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

/** Expected point count for a range (mirrors server math, uncapped). */
export function expectedPointCount(range: DashboardRange): number {
  const q = rangeToQuery(range);
  if (q.hours !== undefined) {
    if (q.bucket === "minute") return Math.max(1, Math.round(q.hours * 60));
    if (q.bucket === "hour") return Math.max(1, Math.round(q.hours));
    return Math.max(1, Math.round(q.hours / 24));
  }
  const d = q.days ?? 1;
  if (q.bucket === "minute") return d * 24 * 60;
  if (q.bucket === "hour") return d * 24;
  return d;
}

/** Map a dashboard range to timeseries query params. */
export function rangeToQuery(range: DashboardRange): TimeseriesQuery {
  const def = RANGE_DEFS.find((r) => r.id === range);
  if (!def) return { bucket: "hour", hours: 24 };
  return def.query;
}

/**
 * Enough retained history to make the window useful:
 * - short windows (≤24h): any history
 * - longer: at least 25% of the lookback so charts aren’t almost empty
 */
export function isRangeAvailable(range: DashboardRange, coverageFrom: string | null, now = new Date()): boolean {
  if (!coverageFrom) return false;
  const from = Date.parse(coverageFrom);
  if (!Number.isFinite(from)) return false;
  const historyMs = Math.max(0, now.getTime() - from);
  const def = RANGE_DEFS.find((r) => r.id === range);
  if (!def) return false;
  if (def.windowMs <= DAY) return historyMs > 0;
  return historyMs >= def.windowMs * 0.25;
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
  scopeKey = "default",
}: {
  value: DashboardRange;
  onChange: (range: DashboardRange) => void;
  /**
   * Oldest retained event.
   * `undefined` = still loading; `null` = no history; string = coverage start.
   */
  coverageFrom?: string | null;
  /** When this changes (e.g. campaign filter), allow one calm snap to a valid range. */
  scopeKey?: string;
}) {
  const loading = coverageFrom === undefined;
  const hasHistory = typeof coverageFrom === "string";
  const snappedKey = useRef<string | null>(null);

  // One intentional snap per scope when coverage first arrives — not on every click/re-render.
  useEffect(() => {
    if (coverageFrom === undefined || coverageFrom === null) return;
    const key = `${scopeKey}:${coverageFrom}`;
    if (snappedKey.current === key) return;
    snappedKey.current = key;
    const next = pickAvailableRange(value, coverageFrom);
    if (next !== value) onChange(next);
    // Only when coverage/scope settles — ignore value churn from the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: avoid fighting the operator
  }, [coverageFrom, scopeKey]);

  if (!loading && coverageFrom === null) {
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
      {RANGE_DEFS.map((r) => {
        const enabled = loading || (hasHistory && isRangeAvailable(r.id, coverageFrom));
        return (
          <button
            key={r.id}
            type="button"
            disabled={loading || !enabled}
            title={
              enabled
                ? undefined
                : "Not enough retained history for this window yet"
            }
            className={cn(
              "rounded px-2 py-1 text-xs font-medium tabular transition-colors",
              value === r.id && enabled ? "bg-zinc-900 text-white" : null,
              value === r.id && !enabled ? "bg-zinc-200 text-zinc-500" : null,
              value !== r.id && enabled ? "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900" : null,
              value !== r.id && !enabled ? "text-zinc-300" : null,
              loading ? "opacity-60" : null,
            )}
            aria-pressed={value === r.id}
            aria-disabled={!enabled}
            onClick={() => {
              if (!enabled) return;
              onChange(r.id);
            }}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
