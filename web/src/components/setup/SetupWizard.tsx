import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { Stepper } from "@/components/Stepper";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, isApiError } from "@/lib/api";
import { useHealth, useSettings, useSetup } from "@/lib/queries";
import { queryKeys } from "@/lib/queryKeys";
import { navigateToTab } from "@/lib/tabs";
import type { DnsCheckResult, SettingsUpdate, SettingsView, SetupSteps, SetupView, SmtpTestResult } from "@/lib/types";
import {
  draftFromSettings,
  isEmail,
  patchAddresses,
  patchDomain,
  patchFinish,
  patchOperator,
  patchProvider,
  smtpFingerprint,
  type SetupDraft,
} from "./draft";
import { AddressesStep } from "./steps/Addresses";
import { DomainStep } from "./steps/Domain";
import { FinishStep } from "./steps/Finish";
import { OperatorStep } from "./steps/Operator";
import { ProviderStep } from "./steps/Provider";

const STEPS = [
  { id: "operator", label: "Operator" },
  { id: "provider", label: "Provider" },
  { id: "domain", label: "Domain" },
  { id: "addresses", label: "Addresses" },
  { id: "finish", label: "Test inboxes" },
] as const;

type StepIndex = 0 | 1 | 2 | 3 | 4;

function stepTitle(index: StepIndex): string {
  if (index === 0) return "Welcome to MamaDirect";
  return STEPS[index].label;
}

export function SetupWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const setup = useSetup(open);
  const settings = useSettings(open);
  const health = useHealth(open);

  const [step, setStep] = useState<StepIndex>(0);
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [smtpTest, setSmtpTest] = useState<SmtpTestResult | null>(null);
  const [testedFp, setTestedFp] = useState<string | null>(null);
  const [dnsResult, setDnsResult] = useState<DnsCheckResult | null>(null);
  const [dnsWarning, setDnsWarning] = useState(false);
  const [launcherPath, setLauncherPath] = useState<string | null>(null);
  const [launcherError, setLauncherError] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [baselineFp, setBaselineFp] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !settings.data) return;
    const key = settings.data.setupCompletedAt ?? "incomplete";
    if (seededFrom === key && draft) return;
    const next = draftFromSettings(settings.data);
    setDraft(next);
    setSeededFrom(key);
    setBaselineFp(smtpFingerprint({ ...next, smtpPass: "", clearPass: false }));
    setSmtpTest(null);
    setTestedFp(null);
    setDnsResult(null);
    setDnsWarning(false);
    setLauncherPath(null);
    setLauncherError(null);
    setCompleteError(null);
    setErrors({});
    setStep(0);
  }, [open, settings.data, seededFrom, draft]);

  useEffect(() => {
    if (!open) {
      setSeededFrom(null);
      setDraft(null);
    }
  }, [open]);

  const canDismiss = Boolean(setup.data?.steps.provider && setup.data?.steps.addresses);

  const currentFp = draft ? smtpFingerprint(draft) : "";
  const credentialsUnchanged = Boolean(baselineFp && currentFp === baselineFp);
  const smtpReady =
    Boolean(smtpTest?.ok && testedFp === currentFp) ||
    Boolean(health.data?.smtp.status === "ok" && credentialsUnchanged && !draft?.clearPass);

  function patchDraft(partial: Partial<SetupDraft>) {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
    if ("provider" in partial || "sesRegion" in partial || "smtpHost" in partial || "smtpPort" in partial || "smtpSecure" in partial || "smtpUser" in partial || "smtpPass" in partial || "clearPass" in partial) {
      setSmtpTest(null);
      setTestedFp(null);
    }
  }

  async function savePatch(body: SettingsUpdate): Promise<SettingsView> {
    const updated = await api.put<SettingsView>("/api/settings", body);
    queryClient.setQueryData(queryKeys.settings, updated);
    await queryClient.invalidateQueries({ queryKey: queryKeys.setup });
    await queryClient.invalidateQueries({ queryKey: queryKeys.health });
    return updated;
  }

  function validate(index: StepIndex): Record<string, string> {
    if (!draft) return {};
    const e: Record<string, string> = {};
    if (index === 0 && !draft.operatorName.trim()) e.operatorName = "Enter your name.";
    if (index === 2 && !isEmail(draft.fromEmail)) e.fromEmail = "Enter a valid from email.";
    if (index === 3) {
      if (!draft.fromName.trim()) e.fromName = "Enter a from name.";
      if (!isEmail(draft.fromEmail)) e.fromEmail = "Enter a valid from email.";
      if (!isEmail(draft.unsubMailbox)) e.unsubMailbox = "Enter a valid unsubscribe mailbox.";
      if (!draft.postalAddress.trim()) e.postalAddress = "Enter a postal address.";
      if (draft.replyTo.trim() && !isEmail(draft.replyTo)) e.replyTo = "Enter a valid reply-to email.";
      if (draft.publicBaseUrl.trim() && !/^https:\/\//i.test(draft.publicBaseUrl.trim())) {
        e.publicBaseUrl = "Public base URL must start with https://";
      }
    }
    if (index === 4 && draft.testInboxes.length < 1) e.testInboxes = "Add at least one test inbox.";
    return e;
  }

  async function goNext() {
    if (!draft) return;
    const e = validate(step);
    setErrors(e);
    if (Object.keys(e).length) return;
    if (step === 1 && !smtpReady) return;

    setSaving(true);
    setCompleteError(null);
    try {
      const patches = [patchOperator, patchProvider, patchDomain, patchAddresses, patchFinish] as const;
      const updated = await savePatch(patches[step](draft));
      setDraft(draftFromSettings(updated));
      if (step === 1) {
        setBaselineFp(smtpFingerprint({ ...draftFromSettings(updated), smtpPass: "", clearPass: false }));
        setDraft((d) => (d ? { ...d, smtpPass: "", clearPass: false } : d));
      }
      if (step === 2 && (!dnsResult || !dnsResult.ok)) setDnsWarning(true);
      if (step < 4) {
        const next = (step + 1) as StepIndex;
        if (next === 3) {
          setDraft((d) => {
            if (!d || d.fromName.trim()) return d;
            return { ...d, fromName: d.organization.trim() || d.operatorName.trim() };
          });
        }
        setStep(next);
        return;
      }
      try {
        const view = await api.post<SetupView>("/api/setup/complete");
        queryClient.setQueryData(queryKeys.setup, view);
        onOpenChange(false);
        navigateToTab("dashboard");
      } catch (err) {
        if (isApiError(err, "setup_incomplete")) {
          const details = err.details as SetupSteps | undefined;
          const missing = details
            ? (Object.keys(details) as (keyof SetupSteps)[]).filter((k) => !details[k])
            : [];
          setCompleteError(
            missing.length
              ? `Still incomplete: ${missing.join(", ")}.`
              : err.message || "Setup is incomplete.",
          );
        } else {
          setCompleteError(err instanceof Error ? err.message : "Could not complete setup.");
        }
      }
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function testSmtp() {
    if (!draft) return;
    setTesting(true);
    setSmtpTest(null);
    try {
      const updated = await savePatch(patchProvider(draft));
      const result = await api.post<SmtpTestResult>("/api/settings/smtp/test");
      setSmtpTest(result);
      const cleared = draftFromSettings(updated);
      setDraft({ ...cleared, smtpPass: "", clearPass: false });
      if (result.ok) {
        const savedFp = smtpFingerprint({ ...cleared, smtpPass: "", clearPass: false });
        setTestedFp(savedFp);
        setBaselineFp(savedFp);
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.health });
    } catch (err) {
      setSmtpTest({
        ok: false,
        message: err instanceof Error ? err.message : "Connection test failed.",
      });
    } finally {
      setTesting(false);
    }
  }

  async function checkDns() {
    if (!draft) return;
    const e = validate(2);
    setErrors(e);
    if (e.fromEmail) return;
    setChecking(true);
    setDnsResult(null);
    try {
      await savePatch(patchDomain(draft));
      const result = await api.post<DnsCheckResult>("/api/settings/dns/check");
      setDnsResult(result);
      setDnsWarning(!result.ok);
      await queryClient.invalidateQueries({ queryKey: queryKeys.health });
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : "DNS check failed.");
    } finally {
      setChecking(false);
    }
  }

  async function addDesktop() {
    setLaunching(true);
    setLauncherError(null);
    setLauncherPath(null);
    try {
      const result = await api.post<{ ok: true; path: string }>("/api/system/desktop-launcher");
      setLauncherPath(result.path);
    } catch (err) {
      setLauncherError(err instanceof Error ? err.message : "Could not create desktop launcher.");
    } finally {
      setLaunching(false);
    }
  }

  const passSet = settings.data?.smtp.passSet ?? false;
  const regions = setup.data?.regions ?? [];

  const stepperSteps = useMemo(
    () =>
      STEPS.map((s, i) => ({
        id: s.id,
        label: s.label,
        done: i < step,
      })),
    [step],
  );

  function handleOpenChange(next: boolean) {
    if (!next && !canDismiss) return;
    onOpenChange(next);
  }

  const busy = saving || testing || checking || launching;
  const nextDisabled = busy || (step === 1 && !smtpReady) || !draft;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        hideClose={!canDismiss}
        className="max-w-xl"
        onEscapeKeyDown={(e) => {
          if (!canDismiss) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (!canDismiss) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (!canDismiss) e.preventDefault();
        }}
      >
        <DialogHeader>
          {step === 0 ? <BrandMark size={40} title="MamaDirect" className="mb-2" /> : null}
          <DialogTitle>{stepTitle(step)}</DialogTitle>
          <DialogDescription className="sr-only">
            First-run setup for MamaDirect. Step {step + 1} of {STEPS.length}.
          </DialogDescription>
        </DialogHeader>

        <Stepper steps={stepperSteps} current={step} onSelect={(i) => i < step && setStep(i as StepIndex)} />

        {!draft || settings.isPending || setup.isPending ? (
          <div className="flex flex-col gap-3" aria-busy="true">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : (
          <>
            {step === 0 ? (
              <OperatorStep draft={draft} onChange={patchDraft} errors={errors} />
            ) : null}
            {step === 1 ? (
              <ProviderStep
                draft={draft}
                onChange={patchDraft}
                regions={regions}
                passSet={passSet}
                testResult={smtpTest}
                testing={testing}
                onTest={() => void testSmtp()}
              />
            ) : null}
            {step === 2 ? (
              <DomainStep
                draft={draft}
                onChange={patchDraft}
                errors={errors}
                checkResult={dnsResult}
                checking={checking}
                onCheck={() => void checkDns()}
                dnsWarning={dnsWarning}
              />
            ) : null}
            {step === 3 ? <AddressesStep draft={draft} onChange={patchDraft} errors={errors} /> : null}
            {step === 4 ? (
              <FinishStep
                draft={draft}
                onChange={patchDraft}
                errors={errors}
                launcherPath={launcherPath}
                launcherError={launcherError}
                launching={launching}
                onAddDesktop={() => void addDesktop()}
              />
            ) : null}
          </>
        )}

        {completeError ? (
          <p role="alert" className="text-sm text-destructive">
            {completeError}
          </p>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="secondary" disabled={step === 0 || busy} onClick={() => setStep((step - 1) as StepIndex)}>
            Previous
          </Button>
          <Button type="button" loading={saving} disabled={nextDisabled} onClick={() => void goNext()}>
            {step === 4 ? "Finish" : "Next"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
