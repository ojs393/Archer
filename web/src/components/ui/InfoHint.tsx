import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Compact "i" control that reveals longer help copy on click. */
export function InfoHint({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors",
            "hover:bg-zinc-100 hover:text-zinc-700 data-[state=open]:text-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            className,
          )}
          aria-label={label}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-[min(22rem,calc(100vw-1.5rem))] leading-relaxed">
        {typeof children === "string" ? <p className="text-sm text-secondary-foreground">{children}</p> : children}
      </PopoverContent>
    </Popover>
  );
}
