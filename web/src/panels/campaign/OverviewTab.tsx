import { lazy, Suspense, useMemo, useState } from "react";
import { Activity, RotateCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { MetricBar } from "@/components/MetricBar";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatNumber, formatRate } from "@/lib/format";
import { useAnalyticsSummary, useAnalyticsTimeseries } from "@/lib/queries/analytics";
import type { CampaignView } from "@/lib/types";
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
  const totals = summary.data?.totals;
  const rates = summary.data?.rates;
  const empty = (totals?.recipients ?? 0) === 0;

  return (
    <div className="flex flex-col gap-3 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
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
          coverageFrom={series.isPending && !series.data ? undefined : (series.data?.coverageFrom ?? null)}
          scopeKey={`campaign-${campaign.id}`}
        />
      </div>

      <MetricBar
        loading={summary.isPending}
        className={live ? "ring-primary/15" : undefined}
        items={[
          {
            label: "Sent",
            value: formatNumber(totals?.sent),
            tone: "ok",
            info: "Scoped to this run’s analytics window.",
            live,
          },
          {
            label: "Failed",
            value: formatNumber(totals?.failed),
            tone: (totals?.failed ?? 0) > 0 ? "danger" : "default",
          },
          {
            label: "Suppressed",
            value: formatNumber(totals?.suppressed),
            tone: (totals?.suppressed ?? 0) > 0 ? "warn" : "default",
          },
          { label: "Pending", value: formatNumber(totals?.pending) },
          { label: "Retry", value: formatNumber(totals?.retry) },
          {
            label: "Uncertain",
            value: formatNumber(totals?.uncertain),
            tone: (totals?.uncertain ?? 0) > 0 ? "warn" : "default",
          },
          { label: "Skipped", value: formatNumber(totals?.skipped) },
          {
            label: "Delivery",
            value: formatRate(rates?.deliveryRate, empty),
            tone: "ok",
          },
          {
            label: "Bounce",
            value: formatRate(rates?.bounceRate, empty),
            tone: (rates?.bounceRate ?? 0) > 0.02 ? "warn" : "default",
          },
          { label: "Reject", value: formatRate(rates?.rejectionRate, empty) },
        ]}
      />

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
