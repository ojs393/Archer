import { BrandMark } from "@/components/BrandMark";
import { HealthDots } from "@/components/HealthDots";
import { StatusPill } from "@/components/StatusPill";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHealth, useStatus } from "@/lib/queries";
import { TAB_IDS } from "@/lib/tabs";
import { TAB_META } from "./tabMeta";

function LiveIndicators() {
  const status = useStatus();
  const health = useHealth();
  const campaign = status.data?.campaign ?? null;
  return (
    <div className="flex max-w-[40vw] shrink-0 items-center gap-1 overflow-hidden sm:max-w-none sm:gap-2">
      {status.isPending ? (
        <Skeleton className="h-7 w-16 rounded-full sm:w-20" />
      ) : (
        <StatusPill compact status={campaign?.status ?? null} detail={campaign?.pauseReason} />
      )}
      <HealthDots health={health.data} />
    </div>
  );
}

export function AppHeader({ ready, setupLocked = false }: { ready: boolean; setupLocked?: boolean }) {
  return (
    <header className="sticky top-0 z-40 h-14 min-w-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-full min-w-0 max-w-content items-center gap-2 px-3 sm:gap-4 sm:px-6">
        <a
          href={setupLocked ? "#/settings" : "#/dashboard"}
          className="flex shrink-0 items-center gap-2 rounded-md text-foreground hover:no-underline"
          aria-label="Archer home"
        >
          <BrandMark size={28} />
          <span className="text-[15px] font-semibold tracking-tight max-sm:hidden">Archer</span>
        </a>
        <TabsList aria-label="Sections" className="scroll-fade-x h-full min-w-0 flex-1 gap-0 sm:gap-0.5">
          {TAB_IDS.map((id) => {
            const { label, icon: Icon } = TAB_META[id];
            const disabled = setupLocked && id !== "settings";
            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value={id}
                    aria-label={label}
                    disabled={disabled}
                    className="h-full shrink-0 px-2.5 max-lg:w-9 max-lg:px-0 max-sm:w-8"
                  >
                    <Icon aria-hidden="true" />
                    <span className="max-lg:hidden">{label}</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent className="lg:hidden">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </TabsList>
        <div className="ml-auto flex shrink-0 items-center">
          {ready ? <LiveIndicators /> : <Skeleton className="h-7 w-24 rounded-full sm:w-36" />}
        </div>
      </div>
    </header>
  );
}
