import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  LayoutDashboard,
  Mail,
  MessageSquareWarning,
  Pause,
  Play,
  Settings2,
  Square,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { isApiError } from "@/lib/api";
import { campaignHash, type CampaignTab } from "@/lib/campaignRoute";
import {
  useCampaign,
  usePauseCampaign,
  useResumeCampaign,
  useStartCampaign,
  useStopCampaign,
} from "@/lib/queries/campaigns";
import { LIVE_REFETCH_MS } from "@/lib/liveSync";
import { navigateToTab } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { CampaignActivityTab } from "./ActivityTab";
import { CampaignConfigureTab } from "./ConfigureTab";
import { CampaignFeedbackTab } from "./FeedbackTab";
import { CampaignOverviewTab } from "./OverviewTab";
import { CampaignSendsTab } from "./SendsTab";
import { SummaryStrip } from "./SummaryStrip";

const ACTIVE = new Set(["running", "waiting_window", "waiting_network"]);
const PAUSED = new Set(["paused", "safety_stop"]);

export default function CampaignPage({ id, tab }: { id: number; tab: CampaignTab }) {
  const campaign = useCampaign(id, true, {
    refetchInterval: (q) => (q.state.data && ACTIVE.has(q.state.data.status) ? LIVE_REFETCH_MS : false),
  });
  const start = useStartCampaign();
  const pause = usePauseCampaign();
  const resume = useResumeCampaign();
  const stop = useStopCampaign();
  const busy = start.isPending || pause.isPending || resume.isPending || stop.isPending;
  const view = campaign.data;
  const live = view ? ACTIVE.has(view.status) : false;

  function setTab(next: string) {
    window.location.hash = campaignHash(id, next as CampaignTab);
  }

  async function run(action: "start" | "pause" | "resume" | "stop") {
    try {
      if (action === "start") await start.mutateAsync(id);
      else if (action === "pause") await pause.mutateAsync(id);
      else if (action === "resume") await resume.mutateAsync(id);
      else await stop.mutateAsync(id);
      toast.success(
        action === "start" ? "Campaign started" : action === "stop" ? "Campaign cancelled" : `Campaign ${action}d`,
      );
      void campaign.refetch();
    } catch (err) {
      toast.error(isApiError(err) ? err.message : `Could not ${action}`);
    }
  }

  if (campaign.isError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Campaign not found"
        action={{ label: "Back to Runs", icon: ArrowLeft, onClick: () => navigateToTab("runs") }}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="campaign-title">
      <button
        type="button"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => navigateToTab("runs")}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        All runs
      </button>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {campaign.isPending ? (
          <Skeleton className="h-8 w-56" />
        ) : (
          <h1 id="campaign-title" className="min-w-0 truncate text-xl font-semibold tracking-tight text-foreground">
            {view?.displayName ?? `Campaign ${id}`}
          </h1>
        )}
        {view ? <StatusPill status={view.status} detail={view.pauseReason} /> : null}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!view || view.status !== "draft" || busy}
            loading={start.isPending}
            onClick={() => void run("start")}
          >
            <Play aria-hidden />
            Start
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!view || !ACTIVE.has(view.status) || busy}
            loading={pause.isPending}
            onClick={() => void run("pause")}
          >
            <Pause aria-hidden />
            Pause
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!view || !PAUSED.has(view.status) || busy}
            loading={resume.isPending}
            onClick={() => void run("resume")}
          >
            <Play aria-hidden />
            Resume
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!view || view.status === "completed" || view.status === "stopped" || busy}
            loading={stop.isPending}
            onClick={() => void run("stop")}
          >
            <Square aria-hidden />
            Cancel
          </Button>
        </div>
      </div>

      {live ? (
        <p
          className={cn(
            "flex items-center gap-2 rounded-md border border-primary/20 bg-primary-subtle px-3 py-2 text-sm text-foreground",
            "animate-in fade-in duration-300",
          )}
          role="status"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          Sending — counts and activity update live.
        </p>
      ) : null}

      <SummaryStrip campaign={view ?? null} loading={campaign.isPending} live={live} />

      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-3">
        <TabsList aria-label="Campaign sections">
          <TabsTrigger value="overview">
            <LayoutDashboard aria-hidden />
            Overview
          </TabsTrigger>
          <TabsTrigger value="sends">
            <Mail aria-hidden />
            Sends
          </TabsTrigger>
          <TabsTrigger value="activity">
            <Activity aria-hidden />
            Activity
          </TabsTrigger>
          <TabsTrigger value="configure">
            <Settings2 aria-hidden />
            Configure
          </TabsTrigger>
          <TabsTrigger value="feedback">
            <MessageSquareWarning aria-hidden />
            Feedback
          </TabsTrigger>
        </TabsList>
        {view ? (
          <>
            <TabsContent value="overview">
              <CampaignOverviewTab campaign={view} live={live} />
            </TabsContent>
            <TabsContent value="sends">
              <CampaignSendsTab campaign={view} />
            </TabsContent>
            <TabsContent value="activity">
              <CampaignActivityTab campaignId={view.id} />
            </TabsContent>
            <TabsContent value="configure">
              <CampaignConfigureTab campaign={view} />
            </TabsContent>
            <TabsContent value="feedback">
              <CampaignFeedbackTab campaignId={view.id} />
            </TabsContent>
          </>
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </Tabs>
    </section>
  );
}
