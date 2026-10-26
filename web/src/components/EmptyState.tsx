import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

export function EmptyState({
  icon: Icon,
  title,
  action,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  action?: EmptyStateAction;
  /** Optional extra element under the title, such as an InfoHint. */
  children?: ReactNode;
  className?: string;
}) {
  const ActionIcon = action?.icon;
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="flex items-center gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {children}
      </div>
      {action ? (
        <Button variant="subtle" size="sm" onClick={action.onClick}>
          {ActionIcon ? <ActionIcon aria-hidden="true" /> : null}
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
