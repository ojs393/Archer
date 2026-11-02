import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AppWindow, CircleCheck, PlugZap, RotateCw, Save, Settings } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { FieldRow } from "@/components/FieldRow";
import { EmptyState } from "@/components/EmptyState";
import { StatusDot } from "@/components/StatusDot";
import {
  draftFromSettings,
  isEmail,
  patchAddresses,
  patchDomain,
  patchFinish,
  patchOperator,
  patchProvider,
  smtpFingerprint,
  validateProviderDraft,
  type SetupDraft,
} from "@/components/setup/draft";
import { AddressesStep } from "@/components/setup/steps/Addresses";
import { DomainStep } from "@/components/setup/steps/Domain";
import { FinishStep } from "@/components/setup/steps/Finish";
import { OperatorStep } from "@/components/setup/steps/Operator";
import { ProviderStep } from "@/components/setup/steps/Provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { api, isApiError } from "@/lib/api";
import { useHealth, useSettings, useSetup } from "@/lib/queries";
import { queryKeys } from "@/lib/queryKeys";
import { requestSetupWizard } from "@/lib/setupEvent";
import type { DnsCheckResult, SettingsUpdate, SettingsView, SetupView, SmtpTestResult } from "@/lib/types";
import { PanelShell } from "./PanelShell";

function SettingsSection({
  title,
  description,
  children,
  onSave,
  saving,
  actions,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onSave: () => void;
  saving: boolean;
  actions?: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{description}</p>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        {actions}
        <Button type="button" onClick={onSave} loading={saving}>
          {saving ? null : <Save aria-hidden="true" />}
          Save
        </Button>
      </div>
    </Card>
  );
}

function HealthLine({ label, status, detail }: { label: string; status: string; detail: string }) {
  const tone = status === "ok" ? "ok" : status === "unknown" ? "neutral" : "error";
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm">
      <StatusDot tone={tone} className="mt-1" />
      <div className="min-w-0">
        <p className="font-medium text-foreground">
          {label}
          <span className="ml-1.5 font-normal text-muted-foreground">· {status}</span>
        </p>
        {detail ? <p className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{detail}</p> : null}
      </div>
    </div>
  );
}

export default function SettingsPanel() {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const setup = useSetup();
  const health = useHealth();

  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [timezone, setTimezone] = useState("UTC");
  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  const [baselineFp, setBaselineFp] = useState<string | null>(null);
  const [smtpTest, setSmtpTest] = useState<SmtpTestResult | null>(null);
  const [testedFp, setTestedFp] = useState<string | null>(null);
  const [dnsCheck, setDnsCheck] = useState<DnsCheckResult | null>(null);
  const [sectionSaving, setSectionSaving] = useState<string | null>(null);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [checkingDns, setCheckingDns] = useState(false);
  const [launcherPath, setLauncherPath] = useState<string | null>(null);
  const [launcherError, setLauncherError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    const key = settings.data.setupCompletedAt ?? "open";
    if (seededFrom === key && draft) return;
    const next = draftFromSettings(settings.data);
    setDraft(next);
    setTimezone(settings.data.timezone || "UTC");
    setBaselineFp(smtpFingerprint(next));
    setSeededFrom(key);
    setSmtpTest(null);
    setTestedFp(null);
    setDnsCheck(null);
  }, [settings.data, seededFrom, draft]);

  const reset = useMutation({
    mutationFn: () => api.post<SetupView>("/api/setup/reset"),
    onSuccess: (view) => {
      queryClient.setQueryData(queryKeys.setup, view);
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      requestSetupWizard();
    },
  });

  function patchDraft(partial: Partial<SetupDraft>) {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
    if (
      "provider" in partial ||
      "sesRegion" in partial ||
      "smtpHost" in partial ||
      "smtpPort" in partial ||
      "smtpSecure" in partial ||
      "smtpUser" in partial ||
      "smtpPass" in partial ||
      "clearPass" in partial
    ) {
      setSmtpTest(null);
      setTestedFp(null);
    }
  }

  async function savePatch(body: SettingsUpdate): Promise<SettingsView> {
    const updated = await api.put<SettingsView>("/api/settings", body);
    queryClient.setQueryData(queryKeys.settings, updated);
    await queryClient.invalidateQueries({ queryKey: queryKeys.setup });
    await queryClient.invalidateQueries({ queryKey: queryKeys.health });
    const next = draftFromSettings(updated);
    setDraft(next);
    setTimezone(updated.timezone || "UTC");
    setBaselineFp(smtpFingerprint(next));
    setSeededFrom(updated.setupCompletedAt ?? "open");
    return updated;
  }

  async function saveSection(id: string, body: SettingsUpdate, okMessage: string) {
    setSectionSaving(id);
    try {
      await savePatch(body);
      toast.success(okMessage);
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Could not save settings");
    } finally {
      setSectionSaving(null);
    }
  }

  async function testSmtp() {
    if (!draft) return;
    setTestingSmtp(true);
    try {
      // Persist credentials first so the server tests what the form shows.
      await savePatch(patchProvider(draft));
      const result = await api.post<SmtpTestResult>("/api/settings/smtp/test");
      setSmtpTest(result);
      setTestedFp(smtpFingerprint(draft));
      if (result.ok) toast.success("SMTP connection ok");
      else toast.error(result.message || "SMTP test failed");
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "SMTP test failed");
    } finally {
      setTestingSmtp(false);
    }
  }

  async function checkDns() {
    if (!draft) return;
    setCheckingDns(true);
    try {
      await savePatch(patchDomain(draft));
      const result = await api.post<DnsCheckResult>("/api/settings/dns/check");
      setDnsCheck(result);
      toast.success("DNS check finished");
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "DNS check failed");
    } finally {
      setCheckingDns(false);
    }
  }

  async function addDesktop() {
    setLaunching(true);
    setLauncherError(null);
    try {
      const res = await api.post<{ path: string }>("/api/system/desktop-launcher");
      setLauncherPath(res.path);
      toast.success("Desktop launcher created");
    } catch (err) {
      const message = isApiError(err) ? err.message : "Could not create launcher";
      setLauncherError(message);
      toast.error(message);
    } finally {
      setLaunching(false);
    }
  }

  const loading = settings.isPending || setup.isPending;
  const regions = setup.data?.regions ?? [];
  const passSet = settings.data?.smtp.passSet ?? false;
  const currentFp = draft ? smtpFingerprint(draft) : "";
  const credentialsUnchanged = Boolean(baselineFp && currentFp === baselineFp);
  const smtpReady =
    Boolean(smtpTest?.ok && testedFp === currentFp) ||
    Boolean(health.data?.smtp.status === "ok" && credentialsUnchanged && !draft?.clearPass);

  return (
    <PanelShell
      title="Settings"
      info="Operator, sender, provider, DNS, test inboxes, and app options. Each section saves on its own."
      actions={
        <Button type="button" variant="secondary" loading={reset.isPending} onClick={() => reset.mutate()}>
          {reset.isPending ? null : <RotateCw aria-hidden="true" />}
          Re-run setup
        </Button>
      }
    >
      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : settings.isError || !draft ? (
        <Card className="p-6">
          <EmptyState
            icon={Settings}
            title="Could not load settings"
            action={{ label: "Retry", icon: RotateCw, onClick: () => void settings.refetch() }}
          />
        </Card>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <SettingsSection
            title="Operator"
            description="Who runs this install. Local only — not shown to recipients."
            saving={sectionSaving === "operator"}
            onSave={() => {
              if (!draft.operatorName.trim()) {
                toast.error("Enter your name.");
                return;
              }
              void saveSection("operator", patchOperator(draft), "Operator saved");
            }}
          >
            <OperatorStep draft={draft} onChange={patchDraft} errors={{}} />
          </SettingsSection>

          <SettingsSection
            title="Sender"
            description="From identity, reply-to, unsubscribe mailbox, postal address, public URL."
            saving={sectionSaving === "sender"}
            onSave={() => {
              if (!draft.fromName.trim()) {
                toast.error("Enter a from name.");
                return;
              }
              if (!isEmail(draft.fromEmail)) {
                toast.error("Enter a valid from email.");
                return;
              }
              if (!isEmail(draft.unsubMailbox)) {
                toast.error("Enter a valid unsubscribe mailbox.");
                return;
              }
              if (!draft.postalAddress.trim()) {
                toast.error("Enter a postal address.");
                return;
              }
              if (draft.replyTo.trim() && !isEmail(draft.replyTo)) {
                toast.error("Enter a valid reply-to email.");
                return;
              }
              if (draft.publicBaseUrl.trim() && !/^https:\/\//i.test(draft.publicBaseUrl.trim())) {
                toast.error("Public base URL must start with https://");
                return;
              }
              void saveSection("sender", patchAddresses(draft), "Sender saved");
            }}
          >
            <AddressesStep draft={draft} onChange={patchDraft} errors={{}} />
          </SettingsSection>

          <SettingsSection
            title="Provider"
            description="SES or SMTP credentials used for every send."
            saving={sectionSaving === "provider"}
            onSave={() => {
              const errs = validateProviderDraft(draft);
              const first = Object.values(errs)[0];
              if (first) {
                toast.error(first);
                return;
              }
              void saveSection("provider", patchProvider(draft), "Provider saved");
            }}
            actions={
              <Button type="button" variant="secondary" loading={testingSmtp} onClick={() => void testSmtp()}>
                {testingSmtp ? null : <PlugZap aria-hidden="true" />}
                Test SMTP
              </Button>
            }
          >
            <ProviderStep
              draft={draft}
              onChange={patchDraft}
              regions={regions}
              passSet={passSet}
              testResult={smtpTest}
              testing={testingSmtp}
              onTest={() => void testSmtp()}
            />
            {smtpReady ? (
              <p className="mt-3 text-xs text-muted-foreground">SMTP looks ready for this install.</p>
            ) : null}
          </SettingsSection>

          <SettingsSection
            title="Domain & DNS"
            description="From domain and DKIM selector. Check SPF / DKIM / DMARC before launching runs."
            saving={sectionSaving === "domain"}
            onSave={() => {
              if (!isEmail(draft.fromEmail)) {
                toast.error("Enter a valid from email.");
                return;
              }
              void saveSection("domain", patchDomain(draft), "Domain saved");
            }}
          >
            <DomainStep
              draft={draft}
              onChange={patchDraft}
              errors={{}}
              checkResult={dnsCheck}
              checking={checkingDns}
              onCheck={() => void checkDns()}
              dnsWarning={false}
            />
          </SettingsSection>

          <SettingsSection
            title="Test inboxes"
            description="Addresses used for test sends from the run wizard. At least one required."
            saving={sectionSaving === "inboxes"}
            onSave={() => {
              if (draft.testInboxes.length < 1) {
                toast.error("Add at least one test inbox.");
                return;
              }
              void saveSection("inboxes", patchFinish(draft), "Test inboxes saved");
            }}
          >
            <FinishStep
              draft={draft}
              onChange={patchDraft}
              errors={{}}
              launcherPath={null}
              launcherError={null}
              launching={false}
              onAddDesktop={() => undefined}
              showDesktop={false}
            />
          </SettingsSection>

          <SettingsSection
            title="App"
            description="Timezone, health snapshot, desktop launcher, and setup status."
            saving={sectionSaving === "app"}
            onSave={() => {
              if (!timezone.trim()) {
                toast.error("Enter a timezone.");
                return;
              }
              void saveSection("app", { timezone: timezone.trim() }, "App settings saved");
            }}
            actions={
              <Button type="button" variant="secondary" loading={launching} onClick={() => void addDesktop()}>
                {launching ? null : <AppWindow aria-hidden="true" />}
                Desktop launcher
              </Button>
            }
          >
            <div className="flex flex-col gap-4">
              <FieldRow
                id="settings-timezone"
                label="Timezone"
                info="IANA name for schedule windows and analytics day boundaries (e.g. America/New_York)."
              >
                <Input
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="America/New_York"
                  spellCheck={false}
                  autoComplete="off"
                />
              </FieldRow>

              <div className="flex flex-col gap-2 rounded-md border border-border bg-zinc-50 px-3 py-3">
                <HealthLine
                  label="SMTP"
                  status={health.data?.smtp.status ?? "unknown"}
                  detail={health.data?.smtp.detail ?? ""}
                />
                <HealthLine
                  label="DNS"
                  status={health.data?.dns.status ?? "unknown"}
                  detail={health.data?.dns.detail ?? ""}
                />
                <HealthLine
                  label="Worker"
                  status={health.data?.worker.status ?? "unknown"}
                  detail={health.data?.worker.detail ?? ""}
                />
              </div>

              <div className="flex flex-col gap-3 rounded-md border border-border px-3 py-3">
                <div className="flex items-start gap-3">
                  {setup.data?.complete ? (
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  ) : (
                    <Settings className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {setup.data?.complete ? "Setup complete" : "Setup incomplete"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {setup.data?.completedAt
                        ? `Finished ${new Date(setup.data.completedAt).toLocaleString()}`
                        : "Finish every required step below, then complete the wizard. Sending stays locked until then."}
                    </p>
                  </div>
                </div>
                {setup.data && !setup.data.complete ? (
                  <ul className="ml-7 flex flex-col gap-1 text-xs">
                    {(
                      [
                        ["operator", "Operator name"],
                        ["provider", "Provider / SMTP"],
                        ["addresses", "From, postal, unsubscribe"],
                        ["testInboxes", "Test inboxes"],
                        ["domain", "DNS check (needed to launch; optional to finish setup)"],
                      ] as const
                    ).map(([key, label]) => (
                      <li key={key} className={setup.data.steps[key] ? "text-foreground" : "text-destructive"}>
                        <span className="font-medium">{setup.data.steps[key] ? "Pass" : "Need"}</span>
                        {" · "}
                        {label}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!setup.data?.complete ? (
                  <div className="ml-7">
                    <Button type="button" variant="secondary" onClick={() => requestSetupWizard()}>
                      Continue setup wizard
                    </Button>
                  </div>
                ) : null}
              </div>

              {launcherPath ? (
                <p className="break-all text-xs text-muted-foreground [overflow-wrap:anywhere]">Launcher · {launcherPath}</p>
              ) : null}
              {launcherError ? (
                <p role="alert" className="text-xs text-destructive">
                  {launcherError}
                </p>
              ) : null}
            </div>
          </SettingsSection>
        </div>
      )}
    </PanelShell>
  );
}
