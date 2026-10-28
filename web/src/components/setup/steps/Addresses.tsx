import { FieldRow } from "@/components/FieldRow";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SetupDraft } from "../draft";

export function AddressesStep({
  draft,
  onChange,
  errors,
}: {
  draft: SetupDraft;
  onChange: (patch: Partial<SetupDraft>) => void;
  errors: {
    fromName?: string;
    fromEmail?: string;
    unsubMailbox?: string;
    postalAddress?: string;
    publicBaseUrl?: string;
    replyTo?: string;
  };
}) {
  return (
    <div className="flex flex-col gap-4">
      <FieldRow
        id="setup-from-name"
        label="From name"
        info="Display name recipients see in their inbox (e.g. Acme Support)."
        error={errors.fromName}
      >
        <Input value={draft.fromName} onChange={(e) => onChange({ fromName: e.target.value })} autoComplete="organization" />
      </FieldRow>
      <FieldRow
        id="setup-addresses-from-email"
        label="From email"
        info="Must be on a domain you control and verified with your provider (SPF/DKIM)."
        error={errors.fromEmail}
      >
        <Input
          type="email"
          value={draft.fromEmail}
          onChange={(e) => onChange({ fromEmail: e.target.value })}
          autoComplete="email"
          required
        />
      </FieldRow>
      <FieldRow
        id="setup-reply-to"
        label="Reply-To"
        info="Optional. Where replies go if different from From."
        error={errors.replyTo}
      >
        <Input
          type="email"
          value={draft.replyTo}
          onChange={(e) => onChange({ replyTo: e.target.value })}
          placeholder="Optional"
        />
      </FieldRow>
      <FieldRow
        id="setup-unsub-mailbox"
        label="Unsubscribe mailbox"
        info="Mailbox that receives unsubscribe replies (mailto). Can be the same as From."
        error={errors.unsubMailbox}
      >
        <Input
          type="email"
          value={draft.unsubMailbox}
          onChange={(e) => onChange({ unsubMailbox: e.target.value })}
          required
        />
      </FieldRow>
      <FieldRow
        id="setup-postal"
        label="Postal address"
        info="Required by CAN-SPAM. A PO box or virtual mailbox is fine."
        error={errors.postalAddress}
      >
        <Textarea
          value={draft.postalAddress}
          onChange={(e) => onChange({ postalAddress: e.target.value })}
          rows={3}
          required
        />
      </FieldRow>
      <FieldRow
        id="setup-public-base-url"
        label="Public base URL"
        info="Optional. An https URL of a tunnel to this computer's unsubscribe page (e.g. Cloudflare Tunnel). Required for Gmail/Yahoo if you send more than 5,000/day."
        error={errors.publicBaseUrl}
      >
        <Input
          type="url"
          value={draft.publicBaseUrl}
          onChange={(e) => onChange({ publicBaseUrl: e.target.value })}
          placeholder="https://mail.example.com"
        />
      </FieldRow>
    </div>
  );
}
