import type { ReactNode } from "react";
import { InfoHint } from "@/components/ui/InfoHint";

/** Tight page header: title left, actions right — no tall empty band. */
export function PanelShell({ title, info, actions, children }: { title: string; info?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby="panel-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 id="panel-title" className="truncate text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {info ? <InfoHint label={`About ${title}`}>{info}</InfoHint> : null}
        </div>
        {actions ? <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
