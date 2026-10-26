import { FieldRow } from "@/components/FieldRow";
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
    <div className="flex flex-col gap-4">
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
