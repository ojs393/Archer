import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatRate } from "@/lib/format";
import type { CampaignView } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SummaryStrip({
  campaign,
  loading,
  live = false,
}: {
  campaign: CampaignView | null;
  loading?: boolean;
  live?: boolean;
}) {
  const c = campaign?.counts;
  const attempted = (c?.sent ?? 0) + (c?.failed ?? 0) + (c?.skipped_suppressed ?? 0);
  const delivery = attempted === 0 ? null : (c?.sent ?? 0) / attempted;
  const empty = (c?.total ?? 0) === 0;

  const cells: { label: string; value: string; accent?: string }[] = [
    { label: "Recipients", value: formatNumber(c?.total) },
    { label: "Sent", value: formatNumber(c?.sent), accent: "text-primary" },
    { label: "Failed", value: formatNumber(c?.failed), accent: "text-destructive" },
    { label: "Suppressed", value: formatNumber(c?.skipped_suppressed), accent: "text-status-warn" },
    { label: "Uncertain", value: formatNumber(c?.uncertain) },
    { label: "Delivery", value: formatRate(delivery, empty || attempted === 0) },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((cell) => (
        <Card
          key={cell.label}
          className={cn(
            "flex flex-col gap-1 border-border/80 p-3 shadow-card ring-1 ring-black/[0.03]",
            live && cell.label === "Sent" ? "ring-primary/20" : null,
          )}
        >
          <span className="text-xs font-medium text-muted-foreground">{cell.label}</span>
          {loading ? (
            <Skeleton className="h-6 w-12" />
          ) : (
            <span
              className={cn(
                "text-lg font-semibold tabular transition-[color,transform] duration-300",
                cell.accent,
                live && cell.label === "Sent" ? "scale-[1.02]" : null,
              )}
            >
              {cell.value}
            </span>
          )}
        </Card>
      ))}
    </div>
  );
}
