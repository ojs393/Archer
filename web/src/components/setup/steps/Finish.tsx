import { AppWindow, Check, X } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/InfoHint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, focusRing } from "@/lib/utils";
import { useState, type KeyboardEvent } from "react";
import { isEmail, type SetupDraft } from "../draft";

export function FinishStep({
  draft,
  onChange,
  errors,
  launcherPath,
  launcherError,
  launching,
  onAddDesktop,
}: {
  draft: SetupDraft;
  onChange: (patch: Partial<SetupDraft>) => void;
  errors: { testInboxes?: string };
  launcherPath: string | null;
  launcherError: string | null;
  launching: boolean;
  onAddDesktop: () => void;
}) {
  const [pending, setPending] = useState("");

  function addEmails(raw: string) {
    const parts = raw
      .split(/[,;\s]+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...draft.testInboxes];
    for (const email of parts) {
      if (!isEmail(email)) continue;
      if (!next.includes(email)) next.push(email);
    }
    onChange({ testInboxes: next });
    setPending("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addEmails(pending);
    } else if (e.key === "Backspace" && !pending && draft.testInboxes.length > 0) {
      onChange({ testInboxes: draft.testInboxes.slice(0, -1) });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex min-h-6 items-center gap-1">
          <Label htmlFor="setup-test-inboxes">Test inboxes</Label>
          <InfoHint label="About Test inboxes">
            Your own addresses. Test sends go only here — never to the list — until you launch a run.
          </InfoHint>
        </div>
        <div
          className={cn(
            "flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 shadow-card",
            "focus-within:border-primary",
            errors.testInboxes && "border-destructive",
            focusRing,
          )}
        >
          {draft.testInboxes.map((email) => (
            <Badge key={email} variant="default" className="gap-1 pr-0.5">
              <span>{email}</span>
              <IconButton
                label={`Remove ${email}`}
                icon={X}
                className="h-5 w-5"
                onClick={() => onChange({ testInboxes: draft.testInboxes.filter((e) => e !== email) })}
              />
            </Badge>
          ))}
          <Input
            id="setup-test-inboxes"
            value={pending}
            onChange={(e) => setPending(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => addEmails(pending)}
            placeholder={draft.testInboxes.length ? "Add another" : "you@example.com"}
            className="h-7 min-w-[10rem] flex-1 border-0 shadow-none focus-visible:ring-0"
            autoComplete="email"
            aria-invalid={errors.testInboxes ? true : undefined}
            aria-describedby={errors.testInboxes ? "setup-test-inboxes-error" : undefined}
          />
        </div>
        {errors.testInboxes ? (
          <p id="setup-test-inboxes-error" role="alert" className="text-xs text-destructive">
            {errors.testInboxes}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex min-h-6 items-center gap-1">
          <span className="text-sm font-medium text-foreground">Desktop launcher</span>
          <InfoHint label="About Add to Desktop">
            Writes a one-click starter on your Desktop that runs npm start in this project. Safe to skip — you can add
            it later from Settings.
          </InfoHint>
        </div>
        <Button type="button" variant="secondary" loading={launching} onClick={onAddDesktop}>
          {launching ? null : <AppWindow aria-hidden="true" />}
          Add to Desktop
        </Button>
        {launcherPath ? (
          <p role="status" className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-ok" aria-hidden="true" strokeWidth={3} />
            <span className="break-all">{launcherPath}</span>
          </p>
        ) : null}
        {launcherError ? (
          <p role="alert" className="text-sm text-destructive">
            {launcherError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
