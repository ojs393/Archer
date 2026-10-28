import { Activity, RotateCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { useCampaignEvents } from "@/lib/queries/campaigns";

export function CampaignActivityTab({ campaignId }: { campaignId: number }) {
  const events = useCampaignEvents(campaignId);
  const rows = events.data?.rows ?? [];

  return (
    <Card className="animate-in fade-in duration-300">
      {events.isPending ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      ) : events.isError ? (
        <EmptyState
          icon={Activity}
          title="Could not load activity"
          action={{ label: "Retry", icon: RotateCw, onClick: () => void events.refetch() }}
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={Activity} title="No events yet for this campaign" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Badge variant="default">{row.type}</Badge>
                </TableCell>
                <TableCell className="max-w-xl font-normal">{row.message}</TableCell>
                <TableCell>{formatDateTime(row.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
