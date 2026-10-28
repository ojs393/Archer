import { Play, RotateCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/StatusPill";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatNumber, formatRate } from "@/lib/format";
import { requestNewRun } from "@/lib/newRunEvent";
import type { AnalyticsRun } from "@/lib/types";

function openRun(id: number): void {
  window.location.hash = `#/campaigns/${id}`;
}

function openNewRun(): void {
  window.location.hash = "#/runs";
  requestNewRun();
}

export function RunsTab({
  runs,
  loading,
  error,
  onRetry,
}: {
  runs: AnalyticsRun[];
  loading: boolean;
  error: boolean;
  onRetry?: () => void;
}) {
  return (
    <Card className="animate-in fade-in duration-300">
      {loading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      ) : error ? (
        <EmptyState
          icon={Play}
          title="Could not load runs"
          action={onRetry ? { label: "Retry", icon: RotateCw, onClick: onRetry } : undefined}
        />
      ) : runs.length === 0 ? (
        <EmptyState icon={Play} title="No runs yet" action={{ label: "New run", onClick: openNewRun, icon: Play }} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent/Recipients</TableHead>
              <TableHead>Delivery %</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow
                key={run.id}
                className="cursor-pointer"
                tabIndex={0}
                onClick={() => openRun(run.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openRun(run.id);
                  }
                }}
              >
                <TableCell className="font-medium">{run.name}</TableCell>
                <TableCell>
                  <StatusPill status={run.status} />
                </TableCell>
                <TableCell>
                  {formatNumber(run.sent)}/{formatNumber(run.recipients)}
                </TableCell>
                <TableCell>{formatRate(run.deliveryRate, run.recipients === 0)}</TableCell>
                <TableCell>{formatDateTime(run.startedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
