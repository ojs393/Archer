import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { useAnalyticsErrors, type CampaignScope } from "@/lib/queries/analytics";
import type { AnalyticsErrorKind, AnalyticsRun } from "@/lib/types";
import { CampaignFilter } from "./CampaignFilter";

const KIND_LABEL: Record<AnalyticsErrorKind, string> = {
  failed: "Failed",
  suppressed: "Suppressed",
  retry: "Retry",
  uncertain: "Uncertain",
};

export function ErrorsTab({
  runs,
  campaignId,
  onCampaignIdChange,
}: {
  runs: AnalyticsRun[];
  campaignId: CampaignScope;
  onCampaignIdChange: (id: CampaignScope) => void;
}) {
  const errors = useAnalyticsErrors(campaignId);
  const rows = errors.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-3">
      <CampaignFilter runs={runs} value={campaignId} onChange={onCampaignIdChange} />
      <Card>
        {errors.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : errors.isError ? (
          <EmptyState icon={AlertTriangle} title="Could not load errors" />
        ) : rows.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="No errors yet" />
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
              {rows.map((row) => (
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
