import { Activity, RotateCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { formatActivityEvent, type ActivityTone } from "@/lib/formatActivity";
import { useCampaignEvents } from "@/lib/queries/campaigns";

const BADGE: Record<ActivityTone, "default" | "solid" | "info"> = {
  default: "default",
  ok: "info",
  warn: "default",
  danger: "solid",
  info: "info",
};

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
              <TableHead>When</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const formatted = formatActivityEvent(row.type, row.message);
              return (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={BADGE[formatted.tone]}>{formatted.action}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[14rem]">
                    {formatted.recipient ? (
                      <span className="block truncate font-medium">{formatted.recipient}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xl text-sm [overflow-wrap:anywhere]">{formatted.detail}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
