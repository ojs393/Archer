import { MetricBar } from "@/components/MetricBar";
import { formatDateTime, formatNumber, formatRate } from "@/lib/format";
import { useAnalyticsSummary } from "@/lib/queries/analytics";

export function StatRow() {
  const summary = useAnalyticsSummary();
  const totals = summary.data?.totals;
  const rates = summary.data?.rates;
  const empty = (totals?.recipients ?? 0) === 0;
  const attempted =
    (totals?.sent ?? 0) + (totals?.failed ?? 0) + (totals?.suppressed ?? 0) + (totals?.uncertain ?? 0);
  const remaining = (totals?.pending ?? 0) + (totals?.retry ?? 0);

  return (
    <MetricBar
      loading={summary.isPending}
      items={[
        {
          label: "Recipients",
          value: formatNumber(totals?.recipients),
          info: "Everyone on lists that have been used in a run (all-time scope).",
        },
        {
          label: "Sent",
          value: formatNumber(totals?.sent),
          tone: "ok",
          info: "Handed to SMTP successfully.",
        },
        {
          label: "Failed",
          value: formatNumber(totals?.failed),
          tone: (totals?.failed ?? 0) > 0 ? "danger" : "default",
        },
        {
          label: "Suppressed",
          value: formatNumber(totals?.suppressed),
          tone: (totals?.suppressed ?? 0) > 0 ? "warn" : "default",
          info: "Hard bounces / unsubscribes skipped or recorded.",
        },
        { label: "Pending", value: formatNumber(totals?.pending) },
        { label: "Retry", value: formatNumber(totals?.retry) },
        {
          label: "Uncertain",
          value: formatNumber(totals?.uncertain),
          tone: (totals?.uncertain ?? 0) > 0 ? "warn" : "default",
          info: "May have sent during a crash. Never auto-resent.",
        },
        { label: "Skipped", value: formatNumber(totals?.skipped) },
        {
          label: "Queue",
          value: formatNumber(remaining),
          info: "Pending + retry still waiting.",
        },
        {
          label: "Attempted",
          value: formatNumber(attempted),
          info: "Sent + failed + suppressed + uncertain.",
        },
        {
          label: "Delivery",
          value: formatRate(rates?.deliveryRate, empty),
          tone: "ok",
          info: "Sent ÷ (sent + failed + suppressed).",
        },
        {
          label: "Bounce",
          value: formatRate(rates?.bounceRate, empty),
          tone: (rates?.bounceRate ?? 0) > 0.02 ? "warn" : "default",
          info: "Hard bounces ÷ attempts. Auto-stops a run above 5% of the last 200.",
        },
        {
          label: "Reject",
          value: formatRate(rates?.rejectionRate, empty),
          info: "Provider rejections in the recent sample.",
        },
        {
          label: "Last send",
          value: summary.data?.lastSendAt ? formatDateTime(summary.data.lastSendAt) : "—",
          tone: "muted",
        },
      ]}
    />
  );
}
