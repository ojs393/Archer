import { StatusDot } from "@/components/StatusDot";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/format";
import { healthStatusView } from "@/lib/status";
import type { Health, HealthItem } from "@/lib/types";
import { cn, focusRing } from "@/lib/utils";

const ITEMS: readonly { key: keyof Health; label: string }[] = [
  { key: "smtp", label: "SMTP" },
  { key: "dns", label: "DNS" },
  { key: "network", label: "Network" },
  { key: "worker", label: "Worker" },
];

function HealthDot({ label, item }: { label: string; item: HealthItem | undefined }) {
  const view = healthStatusView(item?.status);
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${label}: ${view.label}`}
              className={cn(
                "inline-flex h-8 w-6 items-center justify-center rounded-md transition-colors hover:bg-zinc-100",
                "aria-expanded:bg-zinc-100",
                focusRing,
              )}
            >
              <StatusDot tone={view.tone} />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {label}: {view.label}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-1.5rem))]">
        <div className="flex items-center gap-2">
          <StatusDot tone={view.tone} />
          <span className="font-medium text-foreground">{label}</span>
          <span className="ml-auto text-xs text-muted-foreground">{view.label}</span>
        </div>
        <p className="mt-2 break-words text-sm text-secondary-foreground">{item?.detail || "No details yet."}</p>
        {item?.checkedAt ? <p className="mt-2 text-xs text-muted-foreground tabular">Checked {formatDateTime(item.checkedAt)}</p> : null}
      </PopoverContent>
    </Popover>
  );
}

export function HealthDots({ health, className }: { health: Health | null | undefined; className?: string }) {
  return (
    <div role="group" aria-label="Health" className={cn("flex items-center gap-1", className)}>
      {ITEMS.map(({ key, label }) => (
        <HealthDot key={key} label={label} item={health?.[key]} />
      ))}
    </div>
  );
}
