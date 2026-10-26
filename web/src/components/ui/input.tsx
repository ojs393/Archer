import * as React from "react";
import { cn, focusRing } from "@/lib/utils";

export const fieldClass = cn(
  "w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-card transition-colors",
  "placeholder:text-muted-foreground hover:border-zinc-400",
  "focus-visible:border-primary",
  focusRing,
  "disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-60",
  "aria-[invalid=true]:border-destructive",
);

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        fieldClass,
        "h-9 py-1 file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-primary",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
