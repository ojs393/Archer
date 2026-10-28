import type { AnalyticsBucket } from "@/lib/types";
import { cn } from "@/lib/utils";

export type DashboardRange = "24h" | "7d" | "30d" | "90d";

export const DASHBOARD_RANGES: readonly DashboardRange[] = ["24h", "7d", "30d", "90d"];

/** Map a dashboard range to the timeseries query params. */
export function rangeToQuery(range: DashboardRange): { bucket: AnalyticsBucket; days: number } {
  switch (range) {
    case "24h":
      return { bucket: "hour", days: 1 };
    case "7d":
      return { bucket: "day", days: 7 };
    case "30d":
      return { bucket: "day", days: 30 };
    case "90d":
      return { bucket: "day", days: 90 };
  }
}

export function TimeRange({
  value,
  onChange,
}: {
  value: DashboardRange;
  onChange: (range: DashboardRange) => void;
}) {
  return (
    <div
      className="inline-flex max-w-full flex-wrap rounded-md border border-border p-0.5"
      role="group"
      aria-label="Time range"
    >
      {DASHBOARD_RANGES.map((r) => (
        <button
          key={r}
          type="button"
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium tabular transition-colors",
            value === r ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
          )}
          aria-pressed={value === r}
          onClick={() => onChange(r)}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
