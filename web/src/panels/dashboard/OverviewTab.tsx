import { lazy, Suspense, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { useAnalyticsTimeseries, type CampaignScope } from "@/lib/queries/analytics";
import type { AnalyticsBucket, AnalyticsRun } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CampaignFilter } from "./CampaignFilter";

const OverviewChart = lazy(() => import("./OverviewChart"));

const DAYS: Record<AnalyticsBucket, number> = { hour: 2, day: 30 };

function visiblePoints(points: { t: string }[], coverageFrom: string | null) {
  if (!coverageFrom) return points;
  return points.filter((p) => p.t >= coverageFrom);
}

export function OverviewTab({
  runs,
  campaignId,
  onCampaignIdChange,
}: {
  runs: AnalyticsRun[];
  campaignId: CampaignScope;
  onCampaignIdChange: (id: CampaignScope) => void;
}) {
  const [bucket, setBucket] = useState<AnalyticsBucket>("hour");
  const days = DAYS[bucket];
  const series = useAnalyticsTimeseries(bucket, days, campaignId);
  const points = useMemo(
    () => visiblePoints(series.data?.points ?? [], series.data?.coverageFrom ?? null),
    [series.data?.points, series.data?.coverageFrom],
  );
  const coverageFrom = series.data?.coverageFrom ?? null;
  const truncated = coverageFrom !== null && (series.data?.points.length ?? 0) > points.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <CampaignFilter runs={runs} value={campaignId} onChange={onCampaignIdChange} />
        <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Bucket size">
          {(["hour", "day"] as const).map((b) => (
            <button
              key={b}
              type="button"
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                bucket === b ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
              )}
              aria-pressed={bucket === b}
              onClick={() => setBucket(b)}
            >
              {b === "hour" ? "Hour" : "Day"}
            </button>
          ))}
        </div>
      </div>
      <Card className="p-4">
        {truncated ? (
          <p className="mb-3 text-xs text-muted-foreground">
            Showing data from {formatDateTime(coverageFrom)} (older events rotated out).
          </p>
        ) : null}
        {series.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : series.isError ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Could not load timeseries.</p>
        ) : (
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <OverviewChart points={points as NonNullable<typeof series.data>["points"]} bucket={bucket} />
          </Suspense>
        )}
      </Card>
    </div>
  );
}
