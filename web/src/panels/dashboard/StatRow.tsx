import { StatCard } from "@/components/StatCard";
import { formatNumber, formatRate } from "@/lib/format";
import { useAnalyticsSummary } from "@/lib/queries/analytics";

export function StatRow() {
  const summary = useAnalyticsSummary();
  const totals = summary.data?.totals;
  const rates = summary.data?.rates;
  const empty = (totals?.recipients ?? 0) === 0;
  const loading = summary.isPending;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard
        label="Sent"
        value={formatNumber(totals?.sent)}
        info="Emails the worker has successfully handed to your SMTP provider."
        loading={loading}
      />
      <StatCard
        label="Delivery rate"
        value={formatRate(rates?.deliveryRate, empty)}
        info="Sent ÷ (sent + failed + suppressed)."
        loading={loading}
      />
      <StatCard
        label="Bounce rate"
        value={formatRate(rates?.bounceRate, empty)}
        info="Hard bounces (suppressed) ÷ attempts. Auto-stops a run above 5% of the last 200."
        loading={loading}
      />
      <StatCard
        label="Uncertain"
        value={formatNumber(totals?.uncertain)}
        info="Sends that may have gone out during a crash. Never auto-resent; requeue from Runs if needed."
        loading={loading}
      />
    </div>
  );
}
