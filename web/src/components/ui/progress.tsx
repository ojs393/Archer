import * as ProgressPrimitive from "@radix-ui/react-progress";
import * as React from "react";
import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { live?: boolean }
>(({ className, value, max = 100, live = false, ...props }, ref) => {
  const safeMax = max > 0 ? max : 100;
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, ((value as number) / safeMax) * 100)) : 0;
  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={value === null || value === undefined ? null : Math.min(safeMax, Math.max(0, value))}
      max={safeMax}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 shadow-inner", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full w-full flex-1 bg-primary transition-transform duration-500 ease-out",
          live ? "animate-pulse" : null,
        )}
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
