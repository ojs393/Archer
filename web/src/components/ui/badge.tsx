import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap rounded-full border font-medium tabular",
  {
    variants: {
      variant: {
        default: "border-border bg-background text-secondary-foreground",
        solid: "border-transparent bg-zinc-900 text-white",
        info: "border-transparent bg-primary-subtle text-primary",
      },
      size: {
        default: "gap-1.5 px-2 py-0.5 text-xs",
        sm: "gap-1 px-1.5 py-0 text-[10px] leading-4",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
