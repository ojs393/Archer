import { StatusDot } from "@/components/StatusDot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { campaignStatusView } from "@/lib/status";
import type { CampaignStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatusPill({
  status,
  detail,
  compact = false,
  className,
}: {
  status: CampaignStatus | null | undefined;
  /** Extra context (for example the pause reason), shown as a tooltip. */
  detail?: string | null;
  /** Dot only below the sm breakpoint. */
  compact?: boolean;
  className?: string;
}) {
  const view = campaignStatusView(status);
  const pill = (
    <span
      role="status"
      aria-label={`Run: ${view.label}`}
      tabIndex={detail ? 0 : undefined}
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-full border border-border bg-background px-2.5 text-xs font-medium text-zinc-700",
        compact && "max-sm:w-7 max-sm:justify-center max-sm:px-0",
        className,
      )}
    >
      <StatusDot tone={view.tone} live={view.live} />
      <span className={cn(compact && "max-sm:sr-only")}>{view.label}</span>
    </span>
  );
  if (!detail) return pill;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  );
}
