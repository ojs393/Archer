import { useState } from "react";
import { StatusPill } from "@/components/StatusPill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAnalyticsRuns, type CampaignScope } from "@/lib/queries/analytics";
import { useStatus } from "@/lib/queries";
import { ErrorsTab } from "./dashboard/ErrorsTab";
import { FeedbackTab } from "./dashboard/FeedbackTab";
import { OverviewTab } from "./dashboard/OverviewTab";
import { RunsTab } from "./dashboard/RunsTab";
import { StatRow } from "./dashboard/StatRow";
import { PanelShell } from "./PanelShell";

export default function DashboardPanel() {
  const status = useStatus();
  const runsQuery = useAnalyticsRuns();
  const [campaignId, setCampaignId] = useState<CampaignScope>(null);
  const runs = runsQuery.data?.rows ?? [];
  const active = status.data?.campaign ?? null;

  return (
    <PanelShell title="Dashboard" actions={active ? <StatusPill status={active.status} detail={active.pauseReason} /> : null}>
      <StatRow />
      <Tabs defaultValue="overview" className="flex flex-col gap-4">
        <TabsList aria-label="Dashboard sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab runs={runs} campaignId={campaignId} onCampaignIdChange={setCampaignId} />
        </TabsContent>
        <TabsContent value="errors">
          <ErrorsTab runs={runs} campaignId={campaignId} onCampaignIdChange={setCampaignId} />
        </TabsContent>
        <TabsContent value="runs">
          <RunsTab runs={runs} loading={runsQuery.isPending} error={runsQuery.isError} />
        </TabsContent>
        <TabsContent value="feedback">
          <FeedbackTab />
        </TabsContent>
      </Tabs>
    </PanelShell>
  );
}
