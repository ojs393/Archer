import { FieldRow } from "@/components/FieldRow";
import { IconButton } from "@/components/IconButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn, focusRing } from "@/lib/utils";
import type { SmtpTestResult } from "@/lib/types";
import { Eraser } from "lucide-react";
import type { SetupDraft } from "../draft";

export function ProviderStep({
  draft,
  onChange,
  regions,
  passSet,
  testResult,
  testing,
  onTest,
}: {
  draft: SetupDraft;
  onChange: (patch: Partial<SetupDraft>) => void;
  regions: readonly { id: string; label: string }[];
  passSet: boolean;
  testResult: SmtpTestResult | null;
  testing: boolean;
  onTest: () => void;
}) {
  const showSet = passSet && !draft.clearPass && !draft.smtpPass;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">Mail provider</legend>
        <div className="flex flex-col gap-2 sm:flex-row">
          {(
            [
              { id: "ses" as const, label: "Amazon SES", hint: "Recommended" },
              { id: "smtp" as const, label: "Other SMTP", hint: null },
            ] as const
          ).map((opt) => {
            const selected = draft.provider === opt.id;
            return (
              <label
                key={opt.id}
                className={cn(
                  "flex flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 py-2.5 text-sm transition-colors",
                  selected ? "border-primary bg-primary-subtle text-foreground" : "border-input hover:border-zinc-400",
                  focusRing,
                )}
              >
                <input
                  type="radio"
                  name="setup-provider"
                  className="sr-only"
                  checked={selected}
                  onChange={() => onChange({ provider: opt.id })}
                />
                <span className="font-medium">{opt.label}</span>
                {opt.hint ? <Badge variant="info">{opt.hint}</Badge> : null}
              </label>
            );
          })}
        </div>
      </fieldset>

      {draft.provider === "ses" ? (
        <>
          <FieldRow
            id="setup-ses-region"
            label="SES region"
            info="Must match the region where your SES identity is verified."
          >
            <Select value={draft.sesRegion || undefined} onValueChange={(sesRegion) => onChange({ sesRegion })}>
              <SelectTrigger aria-label="SES region">
                <SelectValue placeholder="Choose a region" />
              </SelectTrigger>
              <SelectContent>
                {regions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow
            id="setup-ses-user"
            label="SMTP username"
            info="In AWS Console → Amazon SES → SMTP settings → Create SMTP credentials. Use the SMTP username and password (not IAM access keys). Pick the region you verified your domain in."
          >
            <Input
              value={draft.smtpUser}
              onChange={(e) => onChange({ smtpUser: e.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </FieldRow>
        </>
      ) : (
        <>
          <FieldRow
            id="setup-smtp-host"
            label="SMTP host"
            info="Your provider's SMTP hostname, e.g. smtp.resend.com."
          >
            <Input
              value={draft.smtpHost}
              onChange={(e) => onChange({ smtpHost: e.target.value })}
              autoComplete="off"
              spellCheck={false}
              placeholder="smtp.example.com"
            />
          </FieldRow>
          <div className="grid grid-cols-2 gap-3">
            <FieldRow id="setup-smtp-port" label="Port">
              <Input
                type="number"
                min={1}
                max={65535}
                value={draft.smtpPort}
                onChange={(e) => onChange({ smtpPort: Number(e.target.value) || 587 })}
              />
            </FieldRow>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="setup-smtp-secure">Implicit TLS</Label>
              <div className="flex h-9 items-center">
                <Switch
                  id="setup-smtp-secure"
                  checked={draft.smtpSecure}
                  onCheckedChange={(smtpSecure) => onChange({ smtpSecure })}
                />
              </div>
            </div>
          </div>
          <FieldRow id="setup-smtp-user" label="Username">
            <Input
              value={draft.smtpUser}
              onChange={(e) => onChange({ smtpUser: e.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </FieldRow>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex min-h-6 items-center gap-1">
          <Label htmlFor="setup-smtp-pass">SMTP password</Label>
        </div>
        <div className="flex items-center gap-2">
          <Input
            id="setup-smtp-pass"
            type="password"
            value={draft.smtpPass}
            onChange={(e) => onChange({ smtpPass: e.target.value, clearPass: false })}
            autoComplete="new-password"
            placeholder={showSet ? "Leave blank to keep" : "Password"}
            className="flex-1"
          />
          {showSet ? <Badge variant="info">Set</Badge> : null}
          {(passSet || draft.smtpPass) && !draft.clearPass ? (
            <IconButton
              label="Clear password"
              icon={Eraser}
              onClick={() => onChange({ smtpPass: "", clearPass: true })}
            />
          ) : null}
        </div>
      </div>
      {draft.clearPass ? <p className="text-xs text-muted-foreground">Password will be cleared on save.</p> : null}

      <div className="flex flex-col gap-2">
        <Button type="button" variant="secondary" loading={testing} onClick={onTest}>
          Test connection
        </Button>
        {testResult ? (
          <p
            role="status"
            className={cn("text-sm", testResult.ok ? "text-status-ok" : "text-destructive")}
          >
            {testResult.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
