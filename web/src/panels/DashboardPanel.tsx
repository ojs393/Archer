import { Send } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { StatCard } from "@/components/StatCard";
import { Card } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { useStatus } from "@/lib/queries";
import { navigateToTab } from "@/lib/tabs";
import { PanelShell } from "./PanelShell";

export default function DashboardPanel() {
  const status = useStatus();
  const campaign = status.data?.campaign ?? null;

  return (
    <PanelShell title="Dashboard">
      {campaign || status.isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Sent"
            value={formatNumber(campaign?.counts.sent)}
            sub={campaign ? `of ${formatNumber(campaign.counts.total)}` : undefined}
            loading={status.isPending}
          />
          <StatCard
            label="Pending"
            value={formatNumber(campaign ? campaign.counts.pending + campaign.counts.retry : undefined)}
            info="Waiting to send, including messages queued for another attempt."
            loading={status.isPending}
          />
          <StatCard
            label="Failed"
            value={formatNumber(campaign?.counts.failed)}
            info="Permanently rejected by the receiving server. Failed addresses are not retried."
            loading={status.isPending}
          />
          <StatCard
            label="Last hour"
            value={formatNumber(campaign?.stats.sentLastHour)}
            info="Messages sent in the last 60 minutes."
            loading={status.isPending}
          />
        </div>
      ) : (
        <Card>
          <EmptyState icon={Send} title="No active run" action={{ label: "Runs", onClick: () => navigateToTab("runs") }} />
        </Card>
      )}
    </PanelShell>
  );
}
