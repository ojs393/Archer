import type { ReactNode } from "react";
import { InfoHint } from "@/components/ui/InfoHint";

export function PanelShell({ title, info, actions, children }: { title: string; info?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby="panel-title" className="flex flex-col gap-5">
      <div className="flex min-h-9 items-center gap-1">
        <h1 id="panel-title" className="text-lg text-foreground">
          {title}
        </h1>
        {info ? <InfoHint label={`About ${title}`}>{info}</InfoHint> : null}
        {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
