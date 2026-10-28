import { lazy, Suspense, useMemo, useState } from "react";
import { Activity, RotateCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatNumber, formatRate } from "@/lib/format";
import { useAnalyticsSummary, useAnalyticsTimeseries } from "@/lib/queries/analytics";
import type { CampaignView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TimeRange, rangeToQuery, type DashboardRange } from "@/panels/dashboard/TimeRange";

const OverviewChart = lazy(() => import("@/panels/dashboard/OverviewChart"));

function visiblePoints(points: { t: string }[], coverageFrom: string | null) {
  if (!coverageFrom) return points;
  return points.filter((p) => p.t >= coverageFrom);
}

export function CampaignOverviewTab({ campaign, live = false }: { campaign: CampaignView; live?: boolean }) {
  const [range, setRange] = useState<DashboardRange>("24h");
  const query = rangeToQuery(range);
  const summary = useAnalyticsSummary(campaign.id);
  const series = useAnalyticsTimeseries(query, campaign.id);
  const points = useMemo(
    () => visiblePoints(series.data?.points ?? [], series.data?.coverageFrom ?? null),
    [series.data?.points, series.data?.coverageFrom],
  );
  const truncated =
    series.data?.coverageFrom != null && (series.data?.points.length ?? 0) > points.length;
  const empty = (summary.data?.totals.recipients ?? 0) === 0;

  return (
    <div className="flex flex-col gap-3 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {campaign.estimate.completionDate
            ? `ETA ${formatDateTime(campaign.estimate.completionDate)}`
            : "No ETA yet"}
          {campaign.stats.sentLastHour > 0
            ? ` · ${formatNumber(campaign.stats.sentLastHour)} sent last hour`
            : null}
        </div>
        <TimeRange
          value={range}
          onChange={setRange}
          coverageFrom={series.isPending ? undefined : (series.data?.coverageFrom ?? null)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className={cn("flex flex-col gap-1 p-3 shadow-card ring-1 ring-black/[0.03]", live ? "ring-primary/15" : null)}>
          <span className="text-xs font-medium text-muted-foreground">Sent (scoped)</span>
          {summary.isPending ? (
            <Skeleton className="h-6 w-14" />
          ) : (
            <span className="text-xl font-semibold tabular text-primary">{formatNumber(summary.data?.totals.sent)}</span>
          )}
        </Card>
        <Card className="flex flex-col gap-1 p-3 shadow-card ring-1 ring-black/[0.03]">
          <span className="text-xs font-medium text-muted-foreground">Failed</span>
          {summary.isPending ? (
            <Skeleton className="h-6 w-14" />
          ) : (
            <span className="text-xl font-semibold tabular text-destructive">{formatNumber(summary.data?.totals.failed)}</span>
          )}
        </Card>
        <Card className="flex flex-col gap-1 p-3 shadow-card ring-1 ring-black/[0.03]">
          <span className="text-xs font-medium text-muted-foreground">Bounce rate</span>
          {summary.isPending ? (
            <Skeleton className="h-6 w-14" />
          ) : (
            <span className="text-xl font-semibold tabular">{formatRate(summary.data?.rates.bounceRate, empty)}</span>
          )}
        </Card>
        <Card className="flex flex-col gap-1 p-3 shadow-card ring-1 ring-black/[0.03]">
          <span className="text-xs font-medium text-muted-foreground">Uncertain</span>
          {summary.isPending ? <Skeleton className="h-6 w-14" /> : <span className="text-xl font-semibold tabular">{formatNumber(summary.data?.totals.uncertain)}</span>}
        </Card>
      </div>

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
            <OverviewChart points={points as NonNullable<typeof series.data>["points"]} bucket={query.bucket} />
          </Suspense>
        )}
      </Card>
    </div>
  );
}
