import { FieldRow } from "@/components/FieldRow";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DnsCheckResult } from "@/lib/types";
import { Copyable } from "../Copyable";
import type { SetupDraft } from "../draft";

function expectedRecord(
  kind: "spf" | "dkim" | "dmarc",
  domain: string,
  selector: string,
  provider: SetupDraft["provider"],
): string {
  if (kind === "spf") {
    return provider === "ses" ? "v=spf1 include:amazonses.com ~all" : "v=spf1 include:YOUR_PROVIDER ~all";
  }
  if (kind === "dmarc") return `v=DMARC1; p=none;`;
  const sel = selector.trim() || "s1";
  return `${sel}._domainkey.${domain || "your-domain.com"}  (TXT or CNAME from your provider)`;
}

function domainFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

function DnsRow({
  label,
  ok,
  detail,
  record,
  expected,
}: {
  label: string;
  ok: boolean;
  detail: string;
  record: string | null;
  expected: string;
}) {
  // Always copy the publish value when failing — never a bad found `record`.
  const publish = expected;
  const showCurrent = Boolean(record && record !== publish);
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <StatusDot tone={ok ? "ok" : "error"} />
        <span className="text-sm font-medium">{label}</span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </div>
      {!ok ? (
        <>
          <Copyable value={publish} />
          {showCurrent ? <p className="truncate text-xs text-muted-foreground">Current: {record}</p> : null}
        </>
      ) : null}
    </div>
  );
}

export function DomainStep({
  draft,
  onChange,
  errors,
  checkResult,
  checking,
  onCheck,
  dnsWarning,
}: {
  draft: SetupDraft;
  onChange: (patch: Partial<SetupDraft>) => void;
  errors: { fromEmail?: string };
  checkResult: DnsCheckResult | null;
  checking: boolean;
  onCheck: () => void;
  dnsWarning: boolean;
}) {
  const domain = domainFromEmail(draft.fromEmail);
  const selector = draft.dkimSelector.trim() || "s1";

  return (
    <div className="flex flex-col gap-4">
      <FieldRow
        id="setup-from-email"
        label="From email"
        info="Add these TXT records at your domain registrar (Route 53, Cloudflare, Namecheap…). Propagation can take up to 48 hours. You can finish setup without DNS passing; launching a run still requires it."
        error={errors.fromEmail}
      >
        <Input
          type="email"
          value={draft.fromEmail}
          onChange={(e) => onChange({ fromEmail: e.target.value })}
          autoComplete="email"
          placeholder="hello@example.com"
          required
        />
      </FieldRow>
      <FieldRow id="setup-dkim-selector" label="DKIM selector">
        <Input
          value={draft.dkimSelector}
          onChange={(e) => onChange({ dkimSelector: e.target.value })}
          placeholder="s1"
          spellCheck={false}
          autoComplete="off"
        />
      </FieldRow>

      <Button type="button" variant="secondary" loading={checking} onClick={onCheck}>
        Check DNS
      </Button>

      {checkResult ? (
        <div className="flex flex-col gap-2">
          <DnsRow
            label="SPF"
            ok={checkResult.spf.ok}
            detail={checkResult.spf.detail}
            record={checkResult.spf.record}
            expected={checkResult.spf.expected ?? expectedRecord("spf", domain, selector, draft.provider)}
          />
          <DnsRow
            label="DKIM"
            ok={checkResult.dkim.ok}
            detail={checkResult.dkim.detail}
            record={null}
            expected={
              checkResult.dkim.expected ??
              expectedRecord("dkim", checkResult.domain || domain, checkResult.dkim.selector ?? selector, draft.provider)
            }
          />
          <DnsRow
            label="DMARC"
            ok={checkResult.dmarc.ok}
            detail={checkResult.dmarc.detail}
            record={checkResult.dmarc.record}
            expected={checkResult.dmarc.expected ?? expectedRecord("dmarc", domain, selector, draft.provider)}
          />
        </div>
      ) : null}

      {dnsWarning ? (
        <p className="text-sm text-muted-foreground">DNS not verified yet — you can continue.</p>
      ) : null}
    </div>
  );
}
