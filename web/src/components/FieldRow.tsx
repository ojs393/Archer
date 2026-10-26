import { Slot } from "@radix-ui/react-slot";
import type { ReactNode } from "react";
import { InfoHint } from "@/components/ui/InfoHint";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Label + optional InfoHint + a single control + error text, with the ARIA wiring done for the control. */
export function FieldRow({
  id,
  label,
  info,
  error,
  children,
  className,
}: {
  /** The control's id. */
  id: string;
  label: string;
  info?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex min-h-6 items-center gap-1">
        <Label htmlFor={id}>{label}</Label>
        {info ? <InfoHint label={`About ${label}`}>{info}</InfoHint> : null}
      </div>
      <Slot id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}>
        {children}
      </Slot>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
