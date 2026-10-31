import type { ReactNode } from "react";
import { InfoHint } from "@/components/ui/InfoHint";

/** Tight page header: title left, actions right — no tall empty band. */
export function PanelShell({ title, info, actions, children }: { title: string; info?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby="panel-title" className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 id="panel-title" className="truncate text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {info ? <InfoHint label={`About ${title}`}>{info}</InfoHint> : null}
        </div>
        {actions ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">{actions}</div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}
