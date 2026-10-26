import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface IconButtonProps extends Omit<ButtonProps, "variant" | "size" | "children" | "aria-label"> {
  /** Accessible name and tooltip text. */
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  tooltipSide?: "top" | "bottom" | "left" | "right";
}

/** Borderless 32x32 icon action with an aria-label and a matching tooltip. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon: Icon, destructive = false, tooltipSide = "bottom", ...props }, ref) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button ref={ref} variant={destructive ? "icon-destructive" : "icon"} aria-label={label} {...props}>
          <Icon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  ),
);
IconButton.displayName = "IconButton";
