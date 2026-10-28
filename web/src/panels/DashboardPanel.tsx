import { useState } from "react";
import { Activity, AlertTriangle, LayoutDashboard, MailCheck, MessageSquareWarning, Play } from "lucide-react";
import { StatusPill } from "@/components/StatusPill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAnalyticsRuns, type CampaignScope } from "@/lib/queries/analytics";
import { useStatus } from "@/lib/queries";
import { ActivityTab } from "./dashboard/ActivityTab";
import { DeliveryTab } from "./dashboard/DeliveryTab";
import { ErrorsTab } from "./dashboard/ErrorsTab";
import { FeedbackTab } from "./dashboard/FeedbackTab";
import { OverviewTab } from "./dashboard/OverviewTab";
import { RunsTab } from "./dashboard/RunsTab";
import { StatRow } from "./dashboard/StatRow";
import { TimeRange, type DashboardRange } from "./dashboard/TimeRange";
import { PanelShell } from "./PanelShell";

export default function DashboardPanel() {
  const status = useStatus();
  const runsQuery = useAnalyticsRuns();
  const [campaignId, setCampaignId] = useState<CampaignScope>(null);
  const [range, setRange] = useState<DashboardRange>("7d");
  const runs = runsQuery.data?.rows ?? [];
  const active = status.data?.campaign ?? null;

  return (
    <PanelShell
      title="Dashboard"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <TimeRange value={range} onChange={setRange} />
          {active ? <StatusPill status={active.status} detail={active.pauseReason} /> : null}
        </div>
      }
    >
      <StatRow />
      <Tabs defaultValue="overview" className="flex flex-col gap-4">
        <TabsList aria-label="Dashboard sections">
          <TabsTrigger value="overview">
            <LayoutDashboard aria-hidden />
            Overview
          </TabsTrigger>
          <TabsTrigger value="activity">
            <Activity aria-hidden />
            Activity
          </TabsTrigger>
          <TabsTrigger value="delivery">
            <MailCheck aria-hidden />
            Delivery
          </TabsTrigger>
          <TabsTrigger value="errors">
            <AlertTriangle aria-hidden />
            Errors
          </TabsTrigger>
          <TabsTrigger value="runs">
            <Play aria-hidden />
            Runs
          </TabsTrigger>
          <TabsTrigger value="feedback">
            <MessageSquareWarning aria-hidden />
            Feedback
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab runs={runs} campaignId={campaignId} onCampaignIdChange={setCampaignId} range={range} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab runs={runs} campaignId={campaignId} onCampaignIdChange={setCampaignId} range={range} />
        </TabsContent>
        <TabsContent value="delivery">
          <DeliveryTab />
        </TabsContent>
        <TabsContent value="errors">
          <ErrorsTab runs={runs} campaignId={campaignId} onCampaignIdChange={setCampaignId} />
        </TabsContent>
        <TabsContent value="runs">
          <RunsTab
            runs={runs}
            loading={runsQuery.isPending}
            error={runsQuery.isError}
            onRetry={() => void runsQuery.refetch()}
          />
        </TabsContent>
        <TabsContent value="feedback">
          <FeedbackTab />
        </TabsContent>
      </Tabs>
    </PanelShell>
  );
}
