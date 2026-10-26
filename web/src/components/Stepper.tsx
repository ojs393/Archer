import { Check } from "lucide-react";
import { cn, focusRing } from "@/lib/utils";

export interface StepperStep {
  id: string;
  label: string;
  /** Marks a step done even when it is after the current one. */
  done?: boolean;
}

export function Stepper({
  steps,
  current,
  onSelect,
  className,
}: {
  steps: readonly StepperStep[];
  current: number;
  /** When given, steps become buttons (for jumping back in a wizard). */
  onSelect?: (index: number) => void;
  className?: string;
}) {
  const active = Math.min(Math.max(0, current), Math.max(0, steps.length - 1));
  return (
    <ol className={cn("flex w-full items-center gap-2", className)}>
      {steps.map((step, index) => {
        const done = step.done ?? index < active;
        const isCurrent = index === active;
        const marker = (
          <>
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular transition-colors",
                done && "border-primary bg-primary text-primary-foreground",
                isCurrent && !done && "border-primary bg-background text-primary ring-4 ring-primary/10",
                !done && !isCurrent && "border-zinc-300 bg-background text-zinc-500",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> : index + 1}
            </span>
            <span className={cn("truncate text-sm max-sm:sr-only", isCurrent ? "font-medium text-foreground" : "text-muted-foreground")}>
              {step.label}
            </span>
          </>
        );
        return (
          <li key={step.id} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none" aria-current={isCurrent ? "step" : undefined}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(index)}
                className={cn("flex min-w-0 items-center gap-2 rounded-md", focusRing)}
              >
                {marker}
              </button>
            ) : (
              <span className="flex min-w-0 items-center gap-2">{marker}</span>
            )}
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className={cn("h-px min-w-4 flex-1", done ? "bg-primary" : "bg-border")} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
