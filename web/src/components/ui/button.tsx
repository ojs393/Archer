import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn, focusRing } from "@/lib/utils";

const buttonVariants = cva(
  cn(
    "inline-flex max-w-full select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium leading-none transition-colors",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    focusRing,
  ),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active",
        secondary: "border border-input bg-background text-zinc-900 hover:bg-zinc-50 active:bg-zinc-100",
        subtle: "bg-transparent text-primary hover:bg-primary-subtle active:bg-blue-100",
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
        destructive: "bg-destructive text-destructive-foreground hover:bg-red-700 active:bg-red-800",
        icon: "h-8 w-8 shrink-0 bg-transparent p-0 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 active:bg-zinc-200",
        "icon-destructive": "h-8 w-8 shrink-0 bg-transparent p-0 text-zinc-600 hover:bg-red-50 hover:text-red-600 active:bg-red-100",
      },
      size: {
        default: "h-9 min-h-9 px-3.5 [&_svg]:size-4",
        sm: "h-8 min-h-8 px-2.5 text-[13px] [&_svg]:size-3.5",
        lg: "h-10 min-h-10 px-5 [&_svg]:size-4",
      },
    },
    compoundVariants: [
      { variant: ["icon", "icon-destructive"], className: "h-8 w-8 min-h-8 px-0 [&_svg]:size-4" },
      { variant: "link", className: "h-auto min-h-0 px-0" },
    ],
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? type : (type ?? "button")}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && !asChild ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            {variant === "icon" || variant === "icon-destructive" ? null : children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
