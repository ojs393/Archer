import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/InfoHint";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type MetricTone = "default" | "ok" | "warn" | "danger" | "muted";

export type MetricItem = {
  label: string;
  value: string;
  tone?: MetricTone;
  info?: ReactNode;
  live?: boolean;
};

const TONE: Record<MetricTone, string> = {
  default: "text-foreground",
  ok: "text-primary",
  warn: "text-status-warn",
  danger: "text-destructive",
  muted: "text-muted-foreground",
};

/** Dense single-line metrics: Label 123 · Label 45% — no tall cards. */
export function MetricBar({
  items,
  loading = false,
  className,
}: {
  items: MetricItem[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("border-border/80 px-3 py-2 shadow-card ring-1 ring-black/[0.03]", className)}>
      {loading ? (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {Array.from({ length: Math.min(items.length || 6, 8) }, (_, i) => (
            <Skeleton key={i} className="h-4 w-20" />
          ))}
        </div>
      ) : (
        <ul className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
          {items.map((item) => (
            <li
              key={item.label}
              className={cn(
                "inline-flex max-w-full items-baseline gap-1 text-xs leading-5",
                item.live ? "rounded-sm bg-primary-subtle/60 px-1" : null,
              )}
            >
              <span className="shrink-0 text-muted-foreground">{item.label}</span>
              {item.info ? <InfoHint label={`About ${item.label}`}>{item.info}</InfoHint> : null}
              <span className={cn("font-semibold tabular", TONE[item.tone ?? "default"])}>{item.value}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
