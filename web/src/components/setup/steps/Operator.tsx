import { ShieldCheck } from "lucide-react";
import { FieldRow } from "@/components/FieldRow";
import { InfoHint } from "@/components/ui/InfoHint";
import { Input } from "@/components/ui/input";
import type { SetupDraft } from "../draft";

export function OperatorStep({
  draft,
  onChange,
  errors,
}: {
  draft: SetupDraft;
  onChange: (patch: Partial<SetupDraft>) => void;
  errors: { operatorName?: string };
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-md border border-border bg-zinc-50 px-3.5 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className="text-sm font-medium text-foreground">Local-only</p>
            <InfoHint label="About local security">
              <div className="flex flex-col gap-2 text-sm text-secondary-foreground">
                <p>Binds to 127.0.0.1 only. Session cookie + CSRF on every change.</p>
                <p>SMTP password is write-only after save and redacted from logs.</p>
                <p>Launch gates still block sends until provider, addresses, and DNS look good.</p>
              </div>
            </InfoHint>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-secondary-foreground">
            Credentials and audiences stay in this computer&apos;s <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">data/</code>{" "}
            folder. Finish these steps before importing lists or sending — Settings can update them anytime after.
          </p>
        </div>
      </div>

      <FieldRow
        id="setup-operator-name"
        label="Your name"
        info="Your name. Shown only on this computer."
        error={errors.operatorName}
      >
        <Input
          value={draft.operatorName}
          onChange={(e) => onChange({ operatorName: e.target.value })}
          autoComplete="name"
          required
        />
      </FieldRow>
      <FieldRow
        id="setup-organization"
        label="Organization"
        info="Brand or company. Used as the default From name on emails."
      >
        <Input
          value={draft.organization}
          onChange={(e) => onChange({ organization: e.target.value })}
          autoComplete="organization"
          placeholder="Optional"
        />
      </FieldRow>
    </div>
  );
}
