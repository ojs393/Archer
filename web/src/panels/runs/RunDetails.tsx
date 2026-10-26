import { formatDateTime, formatNumber } from "@/lib/format";
import { useStatus } from "@/lib/queries";
import { useTemplate } from "@/lib/queries/templates";
import type { CampaignView } from "@/lib/types";
import { campaignLabel } from "./RunsTable";

function scheduleSummary(c: CampaignView): string {
  const s = c.schedule;
  if (!s) return "Schedule unreadable";
  const days = s.sendDays.length === 7 ? "every day" : `days ${s.sendDays.join(",")}`;
  const warm = s.warmup ? "; warm-up on" : "";
  return `${s.startTime}–${s.endTime} ${s.timezone}; ${days}; cap ${s.dailyCap}/day${warm}`;
}

export function RunDetails({
  campaign, lists, templates,
}: {
  campaign: CampaignView;
  lists: Map<number, string>;
  templates: Map<number, string>;
}) {
  const status = useStatus();
  const template = useTemplate(campaign.templateId);
  const live = status.data?.campaign?.id === campaign.id ? status.data.campaign : null;
  const view = live ?? campaign;
  const eta = view.estimate.completionDate;
  const note = view.estimate.perDayCapacityNote;

  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-4 text-sm">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Run</p>
        <p className="font-medium text-foreground">{campaignLabel(campaign, lists, templates)}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Subject</p>
          <p className="text-foreground">{template.data?.subject ?? (template.isPending ? "…" : "—")}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Schedule</p>
          <p className="text-foreground">{scheduleSummary(view)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Started</p>
          <p className="text-foreground">{formatDateTime(view.startedAt)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Finish by (ETA)</p>
          <p className="text-foreground">{eta ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Sent last hour</p>
          <p className="text-foreground">{formatNumber(view.stats.sentLastHour)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Pause reason / last note</p>
          <p className="text-foreground">{view.pauseReason ?? note ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}
