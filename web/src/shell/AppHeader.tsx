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
    <div className="flex items-center gap-1 sm:gap-2">
      {status.isPending ? (
        <Skeleton className="h-7 w-20 rounded-full" />
      ) : (
        <StatusPill compact status={campaign?.status ?? null} detail={campaign?.pauseReason} />
      )}
      <HealthDots health={health.data} />
    </div>
  );
}

export function AppHeader({ ready }: { ready: boolean }) {
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-background">
      <div className="mx-auto flex h-full max-w-content items-center gap-2 px-3 sm:gap-6 sm:px-6">
        <a href="#/dashboard" className="flex shrink-0 items-center gap-2 rounded-md text-foreground hover:no-underline" aria-label="MamaDirect home">
          <BrandMark size={28} />
          <span className="text-[15px] font-semibold tracking-tight max-sm:hidden">MamaDirect</span>
        </a>
        <TabsList aria-label="Sections" className="h-full min-w-0 gap-0 overflow-x-auto sm:gap-1">
          {TAB_IDS.map((id) => {
            const { label, icon: Icon } = TAB_META[id];
            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <TabsTrigger value={id} aria-label={label} className="h-full max-md:w-9 max-md:px-0 max-sm:w-8">
                    <Icon aria-hidden="true" />
                    <span className="max-md:hidden">{label}</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent className="md:hidden">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </TabsList>
        <div className="ml-auto flex shrink-0 items-center">{ready ? <LiveIndicators /> : <Skeleton className="h-7 w-36 rounded-full" />}</div>
      </div>
    </header>
  );
}
