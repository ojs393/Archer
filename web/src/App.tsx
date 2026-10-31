import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { RotateCw, Unplug } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from "react";
import { EmptyState } from "@/components/EmptyState";
import { SetupWizard } from "@/components/setup/SetupWizard";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { TabsContent, Tabs } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSession, useSetup } from "@/lib/queries";
import { lazyPanel } from "@/lib/lazyPanel";
import { createQueryClient } from "@/lib/queryClient";
import { SETUP_EVENT } from "@/lib/setupEvent";
import { isTabId, navigateToTab, TAB_IDS, type TabId } from "@/lib/tabs";
import { useEventStream } from "@/lib/useEventStream";
import { AppHeader } from "@/shell/AppHeader";
import { PanelBoundary } from "@/shell/PanelBoundary";
import { ReconnectBanner } from "@/shell/ReconnectBanner";
import { shellTab, useAppRoute } from "@/shell/useAppRoute";

const PANELS: Record<TabId, LazyExoticComponent<ComponentType>> = {
  dashboard: lazyPanel(() => import("@/panels/DashboardPanel")),
  runs: lazyPanel(() => import("@/panels/RunsPanel")),
  audience: lazyPanel(() => import("@/panels/AudiencePanel")),
  templates: lazyPanel(() => import("@/panels/TemplatesPanel")),
  chains: lazyPanel(() => import("@/panels/chains/ChainsPage")),
  settings: lazyPanel(() => import("@/panels/SettingsPanel")),
};

const CampaignPage = lazy(() => import("@/panels/campaign/CampaignPage"));
const NotFoundPanel = lazy(() => import("@/panels/NotFoundPanel"));

/** Keys Radix uses to move focus between tabs; with automatic activation they also select. */
const ROVING_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

function PanelFallback() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

function Shell() {
  const [route, setTab] = useAppRoute();
  const tab = shellTab(route);
  const session = useSession();
  const ready = session.isSuccess;
  useEventStream({ enabled: ready });
  const setup = useSetup(ready);
  const setupComplete = setup.data?.complete === true;
  const setupLocked = ready && setup.isSuccess && !setupComplete;
  const [wizardOpen, setWizardOpen] = useState(false);
  const activeTab: TabId = setupLocked ? "settings" : (tab ?? "dashboard");
  const Panel = PANELS[activeTab];
  const roving = useRef(false);

  useEffect(() => {
    if (!setup.data) return;
    if (!setup.data.complete) setWizardOpen(true);
    else setWizardOpen(false);
  }, [setup.data]);

  useEffect(() => {
    if (!setupLocked) return;
    if (route.kind !== "tab" || route.tab !== "settings") {
      navigateToTab("settings", { replace: true });
      setTab("settings", { replace: true });
    }
    setWizardOpen(true);
  }, [setupLocked, route, setTab]);

  useEffect(() => {
    const open = () => setWizardOpen(true);
    window.addEventListener(SETUP_EVENT, open);
    return () => window.removeEventListener(SETUP_EVENT, open);
  }, []);

  function handleWizardOpenChange(open: boolean) {
    // Incomplete setup cannot dismiss the wizard.
    if (!open && setupLocked) return;
    setWizardOpen(open);
  }

  function handleTabChange(value: string) {
    if (!isTabId(value)) return;
    if (setupLocked && value !== "settings") {
      setWizardOpen(true);
      setTab("settings", { replace: true });
      return;
    }
    setTab(value, { replace: roving.current });
  }

  const showCampaign = setupComplete && route.kind === "campaign";
  const showNotFound = setupComplete && route.kind === "notfound";
  // Empty string keeps no tab selected on not-found routes.
  const shellTabId = setupLocked ? "settings" : showNotFound ? "" : activeTab;

  return (
    <Tabs
      value={shellTabId}
      onValueChange={handleTabChange}
      onKeyDownCapture={(event) => {
        roving.current = ROVING_KEYS.has(event.key);
      }}
      onPointerDownCapture={() => {
        roving.current = false;
      }}
      onMouseDownCapture={() => {
        roving.current = false;
      }}
      className="flex min-h-screen min-w-0 flex-col overflow-x-clip"
    >
      <AppHeader ready={ready} setupLocked={setupLocked} />
      {ready ? <ReconnectBanner /> : null}
      <main className="mx-auto w-full min-w-0 max-w-content flex-1 px-3 py-4 sm:px-6 sm:py-6">
        {session.isError ? (
          <Card>
            <EmptyState
              icon={Unplug}
              title="Cannot reach Archer"
              action={{ label: "Retry", icon: RotateCw, onClick: () => void session.refetch() }}
            />
          </Card>
        ) : showCampaign ? (
          <PanelBoundary resetKey={`campaign-${route.id}-${route.tab}`}>
            <Suspense fallback={<PanelFallback />}>
              <CampaignPage id={route.id} tab={route.tab} />
            </Suspense>
          </PanelBoundary>
        ) : showNotFound ? (
          <Suspense fallback={<PanelFallback />}>
            <NotFoundPanel />
          </Suspense>
        ) : (
          TAB_IDS.map((id) => (
            <TabsContent key={id} value={id} tabIndex={-1}>
              {ready ? (
                <PanelBoundary resetKey={activeTab}>
                  <Suspense fallback={<PanelFallback />}>
                    {id === activeTab ? <Panel /> : null}
                  </Suspense>
                </PanelBoundary>
              ) : (
                <PanelFallback />
              )}
            </TabsContent>
          ))
        )}
      </main>
      <Toaster />
      {ready ? <SetupWizard open={wizardOpen} onOpenChange={handleWizardOpenChange} locked={setupLocked} /> : null}
    </Tabs>
  );
}

export function App({ client }: { client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <Shell />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
