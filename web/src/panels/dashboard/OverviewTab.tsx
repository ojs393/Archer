import { lazy, Suspense, useMemo } from "react";
import { Activity, RotateCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalyticsTimeseries, type CampaignScope } from "@/lib/queries/analytics";
import type { AnalyticsRun } from "@/lib/types";
import { CampaignFilter } from "./CampaignFilter";
import { rangeToQuery, type DashboardRange } from "./TimeRange";

const OverviewChart = lazy(() => import("./OverviewChart"));

function visiblePoints(points: { t: string }[], coverageFrom: string | null) {
  if (!coverageFrom) return points;
  return points.filter((p) => p.t >= coverageFrom);
}

export function OverviewTab({
  runs,
  campaignId,
  onCampaignIdChange,
  range,
}: {
  runs: AnalyticsRun[];
  campaignId: CampaignScope;
  onCampaignIdChange: (id: CampaignScope) => void;
  range: DashboardRange;
}) {
  const { bucket, days } = rangeToQuery(range);
  const series = useAnalyticsTimeseries(bucket, days, campaignId);
  const points = useMemo(
    () => visiblePoints(series.data?.points ?? [], series.data?.coverageFrom ?? null),
    [series.data?.points, series.data?.coverageFrom],
  );
  const coverageFrom = series.data?.coverageFrom ?? null;
  const truncated = coverageFrom !== null && (series.data?.points.length ?? 0) > points.length;

  return (
    <div className="flex flex-col gap-3 animate-in fade-in duration-300">
      <CampaignFilter runs={runs} value={campaignId} onChange={onCampaignIdChange} />
      <Card className="p-4 shadow-card ring-1 ring-black/[0.03]">
        {truncated ? (
          <p className="mb-3 text-xs text-muted-foreground">Earlier history isn’t retained in this view.</p>
        ) : null}
        {series.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : series.isError ? (
          <EmptyState
            icon={Activity}
            title="Could not load activity"
            action={{ label: "Retry", icon: RotateCw, onClick: () => void series.refetch() }}
          />
        ) : (
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <OverviewChart points={points as NonNullable<typeof series.data>["points"]} bucket={bucket} />
          </Suspense>
        )}
      </Card>
    </div>
  );
}
