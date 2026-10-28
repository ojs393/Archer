import { lazy, Suspense, useMemo } from "react";
import { Activity, AlertTriangle, RotateCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useAnalyticsErrors, useAnalyticsTimeseries, type CampaignScope } from "@/lib/queries/analytics";
import type { AnalyticsErrorKind, AnalyticsPoint, AnalyticsRun } from "@/lib/types";
import { CampaignFilter } from "./CampaignFilter";
import { rangeToQuery, type DashboardRange } from "./TimeRange";

const OverviewChart = lazy(() => import("./OverviewChart"));

const KIND_LABEL: Record<AnalyticsErrorKind, string> = {
  failed: "Failed",
  suppressed: "Suppressed",
  retry: "Retry",
  uncertain: "Uncertain",
};

function visiblePoints(points: AnalyticsPoint[], coverageFrom: string | null) {
  if (!coverageFrom) return points;
  return points.filter((p) => p.t >= coverageFrom);
}

function sumField(points: AnalyticsPoint[], key: keyof Omit<AnalyticsPoint, "t">): number {
  return points.reduce((n, p) => n + p[key], 0);
}

export function ActivityTab({
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
  const query = rangeToQuery(range);
  const series = useAnalyticsTimeseries(query, campaignId);
  const errors = useAnalyticsErrors(campaignId);
  const points = useMemo(
    () => visiblePoints(series.data?.points ?? [], series.data?.coverageFrom ?? null),
    [series.data?.points, series.data?.coverageFrom],
  );
  const coverageFrom = series.data?.coverageFrom ?? null;
  const truncated = coverageFrom !== null && (series.data?.points.length ?? 0) > points.length;
  const errorRows = errors.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-3 animate-in fade-in duration-300">
      <CampaignFilter runs={runs} value={campaignId} onChange={onCampaignIdChange} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            ["Sent", sumField(points, "sent")],
            ["Failed", sumField(points, "failed")],
            ["Suppressed", sumField(points, "suppressed")],
            ["Uncertain", sumField(points, "uncertain")],
          ] as const
        ).map(([label, value]) => (
          <Card key={label} className="flex flex-col gap-1 p-3">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            {series.isPending ? (
              <Skeleton className="h-6 w-12" />
            ) : (
              <span className="text-xl font-semibold tabular">{formatNumber(value)}</span>
            )}
          </Card>
        ))}
      </div>

      <Card className="p-4">
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
            <OverviewChart points={points} bucket={query.bucket} />
          </Suspense>
        )}
      </Card>

      <Card>
        {errors.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : errors.isError ? (
          <EmptyState
            icon={AlertTriangle}
            title="Could not load recent issues"
            action={{ label: "Retry", icon: RotateCw, onClick: () => void errors.refetch() }}
          />
        ) : errorRows.length === 0 ? (
          <EmptyState icon={Activity} title="No recent issues in this range" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Count</TableHead>
                <TableHead>Last</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {errorRows.slice(0, 8).map((row) => (
                <TableRow key={`${row.kind}-${row.message}`}>
                  <TableCell>
                    <Badge variant={row.kind === "failed" || row.kind === "uncertain" ? "info" : "default"}>
                      {KIND_LABEL[row.kind]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-md truncate font-normal">{row.message}</TableCell>
                  <TableCell>{row.count}</TableCell>
                  <TableCell>{formatDateTime(row.lastAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
