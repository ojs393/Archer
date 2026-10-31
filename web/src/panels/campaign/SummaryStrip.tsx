import { MetricBar } from "@/components/MetricBar";
import { Progress } from "@/components/ui/progress";
import { campaignProgress } from "@/lib/campaignProgress";
import { formatNumber, formatRate } from "@/lib/format";
import type { CampaignView } from "@/lib/types";

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
  const total = c?.total ?? 0;
  const sent = c?.sent ?? 0;
  const failed = c?.failed ?? 0;
  const suppressed = c?.skipped_suppressed ?? 0;
  const uncertain = c?.uncertain ?? 0;
  const pending = c?.pending ?? 0;
  const sending = c?.sending ?? 0;
  const retry = c?.retry ?? 0;
  const attempted = sent + failed + suppressed;
  const delivery = attempted === 0 ? null : sent / attempted;
  const bounce = attempted === 0 ? null : suppressed / attempted;
  const progress = c ? campaignProgress(c) : { done: 0, total: 0, ratio: null, label: "—" };
  const empty = total === 0;
  const reject = campaign?.stats.rejectionRate;
  const perHour = campaign?.stats.sentLastHour ?? 0;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border/80 bg-card px-3 py-2 shadow-card ring-1 ring-black/[0.03]">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-medium text-foreground">Send progress</span>
          <span className="tabular text-muted-foreground">{progress.label}</span>
        </div>
        <Progress
          value={progress.done}
          max={progress.total || 1}
          live={live}
          className="h-2"
          aria-label={`Send progress ${progress.label}`}
        />
        <p className="text-[11px] leading-snug text-muted-foreground">
          Done = sent + failed + suppressed + uncertain. Pending and retries are still in flight.
        </p>
      </div>
    <MetricBar
      loading={loading}
      items={[
        {
          label: "Progress",
          value: progress.label === "—" ? "—" : progress.label.replace(" of ", "/"),
          info: "Finished attempts ÷ list size (sent + failed + suppressed + uncertain).",
        },
        {
          label: "Done",
          value: formatRate(progress.ratio, empty),
          tone: "ok",
        },
        {
          label: "Sent",
          value: formatNumber(sent),
          tone: "ok",
          live: live && sending > 0,
          info: "Accepted by SMTP for this run.",
        },
        { label: "Pending", value: formatNumber(pending) },
        {
          label: "Sending",
          value: formatNumber(sending),
          live: live && sending > 0,
        },
        { label: "Retry", value: formatNumber(retry) },
        {
          label: "Failed",
          value: formatNumber(failed),
          tone: failed > 0 ? "danger" : "default",
        },
        {
          label: "Suppressed",
          value: formatNumber(suppressed),
          tone: suppressed > 0 ? "warn" : "default",
        },
        {
          label: "Uncertain",
          value: formatNumber(uncertain),
          tone: uncertain > 0 ? "warn" : "default",
          info: "Crash mid-send. Requeue from Sends if needed.",
        },
        {
          label: "Delivery",
          value: formatRate(delivery, empty || attempted === 0),
          tone: "ok",
          info: "Sent ÷ (sent + failed + suppressed).",
        },
        {
          label: "Bounce",
          value: formatRate(bounce, empty || attempted === 0),
          tone: (bounce ?? 0) > 0.02 ? "warn" : "default",
          info: "Suppressed ÷ attempts for this run.",
        },
        {
          label: "Reject",
          value: formatRate(typeof reject === "number" ? reject : null, empty || (campaign?.stats.sample ?? 0) === 0),
          info: "Provider rejection rate on the recent sample.",
        },
        {
          label: "/hr",
          value: formatNumber(perHour),
          info: "Sent in the last hour for this run.",
          live: live && perHour > 0,
        },
      ]}
    />
    </div>
  );
}
