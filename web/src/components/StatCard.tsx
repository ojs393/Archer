import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/InfoHint";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sub,
  delta,
  info,
  loading = false,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
  info?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-col gap-2 p-4", className)}>
      <div className="flex min-h-6 items-center gap-1">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        {info ? <InfoHint label={`About ${label}`}>{info}</InfoHint> : null}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="truncate text-2xl font-semibold leading-7 text-foreground tabular">{value}</span>
          {delta ? <span className="text-xs text-secondary-foreground tabular">{delta}</span> : null}
        </div>
      )}
      {sub ? <div className="truncate text-xs text-muted-foreground tabular">{sub}</div> : null}
    </Card>
  );
}
