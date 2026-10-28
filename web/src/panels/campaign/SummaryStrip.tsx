import { MetricBar } from "@/components/MetricBar";
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
  const progress = total === 0 ? null : (sent + failed + suppressed + uncertain) / total;
  const empty = total === 0;
  const reject = campaign?.stats.rejectionRate;
  const perHour = campaign?.stats.sentLastHour ?? 0;

  return (
    <MetricBar
      loading={loading}
      items={[
        {
          label: "Progress",
          value: empty ? "—" : `${formatNumber(sent + failed + suppressed + uncertain)}/${formatNumber(total)}`,
          info: "Finished attempts ÷ list size (sent + failed + suppressed + uncertain).",
        },
        {
          label: "Done",
          value: formatRate(progress, empty),
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
  );
}
