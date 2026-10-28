import { MailCheck, RotateCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatRate } from "@/lib/format";
import { useAnalyticsSummary } from "@/lib/queries/analytics";
import { cn } from "@/lib/utils";

type OutcomeKey = "sent" | "failed" | "suppressed" | "uncertain" | "pending" | "skipped" | "retry";

const OUTCOMES: { key: OutcomeKey; label: string; tone: string }[] = [
  { key: "sent", label: "Delivered", tone: "bg-primary" },
  { key: "failed", label: "Failed", tone: "bg-destructive" },
  { key: "suppressed", label: "Suppressed", tone: "bg-status-warn" },
  { key: "uncertain", label: "Uncertain", tone: "bg-orange-500" },
  { key: "pending", label: "Pending", tone: "bg-sky-300" },
  { key: "retry", label: "Retrying", tone: "bg-violet-500" },
  { key: "skipped", label: "Skipped", tone: "bg-zinc-300" },
];

export function DeliveryTab() {
  const summary = useAnalyticsSummary();
  const totals = summary.data?.totals;
  const rates = summary.data?.rates;
  const empty = (totals?.recipients ?? 0) === 0;
  const attempted =
    (totals?.sent ?? 0) + (totals?.failed ?? 0) + (totals?.suppressed ?? 0) + (totals?.uncertain ?? 0) || 1;

  return (
    <div className="flex flex-col gap-3 animate-in fade-in duration-300">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-xs font-medium text-muted-foreground">Delivery rate</span>
          {summary.isPending ? (
            <Skeleton className="h-7 w-20" />
          ) : (
            <span className="text-2xl font-semibold tabular">{formatRate(rates?.deliveryRate, empty)}</span>
          )}
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-xs font-medium text-muted-foreground">Bounce rate</span>
          {summary.isPending ? (
            <Skeleton className="h-7 w-20" />
          ) : (
            <span className="text-2xl font-semibold tabular">{formatRate(rates?.bounceRate, empty)}</span>
          )}
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-xs font-medium text-muted-foreground">Rejection rate</span>
          {summary.isPending ? (
            <Skeleton className="h-7 w-20" />
          ) : (
            <span className="text-2xl font-semibold tabular">{formatRate(rates?.rejectionRate, empty)}</span>
          )}
        </Card>
      </div>

      <Card className="p-4">
        {summary.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : summary.isError || !totals ? (
          <EmptyState
            icon={MailCheck}
            title="Could not load delivery"
            action={{ label: "Retry", icon: RotateCw, onClick: () => void summary.refetch() }}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Outcome mix</p>
              <p className="text-xs text-muted-foreground">All-time counts across every run.</p>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100">
              {OUTCOMES.map(({ key, tone }) => {
                const n = totals[key];
                if (n <= 0) return null;
                return (
                  <div
                    key={key}
                    className={cn(tone, "h-full transition-[width] duration-500")}
                    style={{ width: `${(n / attempted) * 100}%` }}
                    title={`${key}: ${n}`}
                  />
                );
              })}
            </div>
            <ul className="flex flex-col gap-2">
              {OUTCOMES.map(({ key, label, tone }) => {
                const n = totals[key];
                if (n <= 0 && key !== "sent" && key !== "failed" && key !== "suppressed") return null;
                const pct = empty ? 0 : n / attempted;
                return (
                  <li key={key} className="flex items-center gap-3">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone)} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{label}</span>
                    <span className="text-sm tabular text-muted-foreground">{formatRate(pct, empty)}</span>
                    <span className="w-16 text-right text-sm font-medium tabular">{formatNumber(n)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
