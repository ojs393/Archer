import { MessageSquareWarning, RotateCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Card } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/InfoHint";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalyticsErrors, useAnalyticsFeedback } from "@/lib/queries/analytics";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function CampaignFeedbackTab({ campaignId }: { campaignId: number }) {
  const feedback = useAnalyticsFeedback();
  const errors = useAnalyticsErrors(campaignId);
  const suppressRows = (errors.data?.rows ?? []).filter((r) => r.kind === "suppressed");

  return (
    <div className="flex flex-col gap-3 animate-in fade-in duration-300">
      <Card className="p-4">
        {feedback.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : feedback.isError || !feedback.data ? (
          <EmptyState
            icon={MessageSquareWarning}
            title="Could not load feedback"
            action={{ label: "Retry", icon: RotateCw, onClick: () => void feedback.refetch() }}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-secondary-foreground">Complaints (account)</p>
                <p className="text-2xl font-semibold tabular-nums">{feedback.data.complaints}</p>
              </div>
              <div>
                <p className="text-sm text-secondary-foreground">Permanent bounces (account)</p>
                <p className="text-2xl font-semibold tabular-nums">{feedback.data.bounces}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              SNS complaint and bounce totals are account-level unless the provider tags a campaign id. Campaign-linked
              suppressions appear below.
            </p>
            <p className="text-sm text-secondary-foreground">{feedback.data.reason}</p>
            <InfoHint label="About SES feedback">
              <ol className="list-decimal space-y-2 pl-4 text-sm text-secondary-foreground">
                {feedback.data.guidance.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </InfoHint>
          </div>
        )}
      </Card>

      <Card>
        {errors.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
          </div>
        ) : suppressRows.length === 0 ? (
          <EmptyState icon={MessageSquareWarning} title="No suppressions recorded for this campaign yet" />
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
              {suppressRows.map((row) => (
                <TableRow key={`${row.kind}-${row.message}`}>
                  <TableCell>
                    <Badge variant="default">{row.kind}</Badge>
                  </TableCell>
                  <TableCell className="max-w-md truncate">{row.message}</TableCell>
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
