import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { RotateCw, Unplug } from "lucide-react";
import { Suspense, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from "react";
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
import { isTabId, TAB_IDS, type TabId } from "@/lib/tabs";
import { useEventStream } from "@/lib/useEventStream";
import { AppHeader } from "@/shell/AppHeader";
import { PanelBoundary } from "@/shell/PanelBoundary";
import { ReconnectBanner } from "@/shell/ReconnectBanner";
import { useHashTab } from "@/shell/useHashTab";

const PANELS: Record<TabId, LazyExoticComponent<ComponentType>> = {
  dashboard: lazyPanel(() => import("@/panels/DashboardPanel")),
  runs: lazyPanel(() => import("@/panels/RunsPanel")),
  audience: lazyPanel(() => import("@/panels/AudiencePanel")),
  templates: lazyPanel(() => import("@/panels/TemplatesPanel")),
  settings: lazyPanel(() => import("@/panels/SettingsPanel")),
};

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
  const [tab, setTab] = useHashTab();
  const session = useSession();
  const ready = session.isSuccess;
  useEventStream({ enabled: ready });
  const setup = useSetup(ready);
  const [wizardOpen, setWizardOpen] = useState(false);
  const Panel = PANELS[tab];
  const roving = useRef(false);
  /** User closed the wizard while setup was still incomplete; don't auto-reopen on refetch. */
  const dismissedIncompleteRef = useRef(false);
  const wasCompleteRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!setup.data) return;
    const complete = setup.data.complete;
    if (complete) {
      dismissedIncompleteRef.current = false;
    } else if (wasCompleteRef.current === true) {
      // complete → incomplete (e.g. Re-run / reset): allow auto-open again
      dismissedIncompleteRef.current = false;
    }
    wasCompleteRef.current = complete;
    if (!complete && !dismissedIncompleteRef.current) setWizardOpen(true);
  }, [setup.data]);

  useEffect(() => {
    const open = () => {
      dismissedIncompleteRef.current = false;
      setWizardOpen(true);
    };
    window.addEventListener(SETUP_EVENT, open);
    return () => window.removeEventListener(SETUP_EVENT, open);
  }, []);

  function handleWizardOpenChange(open: boolean) {
    if (!open && setup.data && setup.data.complete === false) {
      dismissedIncompleteRef.current = true;
    }
    setWizardOpen(open);
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => isTabId(value) && setTab(value, { replace: roving.current })}
      onKeyDownCapture={(event) => {
        roving.current = ROVING_KEYS.has(event.key);
      }}
      onPointerDownCapture={() => {
        roving.current = false;
      }}
      onMouseDownCapture={() => {
        roving.current = false;
      }}
      className="flex min-h-screen flex-col"
    >
      <AppHeader ready={ready} />
      {ready ? <ReconnectBanner /> : null}
      <main className="mx-auto w-full max-w-content flex-1 p-6">
        {session.isError ? (
          <Card>
            <EmptyState
              icon={Unplug}
              title="Cannot reach MamaDirect"
              action={{ label: "Retry", icon: RotateCw, onClick: () => void session.refetch() }}
            />
          </Card>
        ) : (
          TAB_IDS.map((id) => (
            <TabsContent key={id} value={id} tabIndex={-1}>
              {ready ? (
                <PanelBoundary resetKey={tab}>
                  <Suspense fallback={<PanelFallback />}>
                    <Panel />
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
      {ready ? <SetupWizard open={wizardOpen} onOpenChange={handleWizardOpenChange} /> : null}
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
