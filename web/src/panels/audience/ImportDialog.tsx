import { Check, ChevronLeft, ChevronRight, FileSpreadsheet, Upload } from "lucide-react";
import { useCallback, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FieldRow } from "@/components/FieldRow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  wizardPanelClass,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, isApiError } from "@/lib/api";
import { assertUploadSize, importList, previewListCsv, UPLOAD_MAX_BYTES } from "@/lib/queries/lists";
import { queryKeys } from "@/lib/queryKeys";
import { useStreamEvent } from "@/lib/useEventStream";
import { cn } from "@/lib/utils";
import type { ImportEvent, ListDetail, ListPreview } from "@/lib/types";

type ImportResult = {
  listId: number;
  valid_count: number;
  invalid_count: number;
  duplicate_count: number;
  suppressed_count: number;
  role_count: number;
  status: string;
};

type ProgressState = {
  phase: ImportEvent["phase"];
  rowsProcessed?: number;
  domainsChecked?: number;
  domainsTotal?: number;
  error?: string;
};

type Step = 0 | 1 | 2 | 3;

const STEPS = ["Formats", "Upload", "Map & consent", "Result"] as const;

const ACCEPTED =
  ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain,application/vnd.ms-excel";

/** Schemas the CSV parser accepts — keep in sync with server/import/csv.ts. */
const SCHEMAS: { title: string; body: string; example: string }[] = [
  {
    title: "Comma CSV (headers)",
    body: "Most exports. First row is headers; we auto-pick the email column.",
    example: "email,first_name,company\nalex@example.com,Alex,Acme",
  },
  {
    title: "Semicolon CSV",
    body: "Common in EU Excel exports. Delimiter is sniffed from the first line.",
    example: "email;first_name\nalex@example.com;Alex",
  },
  {
    title: "Tab-separated (TSV)",
    body: "Paste from spreadsheets or .tsv files. Same header rules as CSV.",
    example: "email\tfirst_name\nalex@example.com\tAlex",
  },
  {
    title: "Headerless",
    body: "If the first row looks like an email, we treat every column as data and name them column_1…",
    example: "alex@example.com,Alex,Acme",
  },
  {
    title: "Email column names",
    body: "Matched case-insensitively: email, e-mail, email address, email_address, mail, recipient, to, courriel, … Or pick manually after preview.",
    example: "Email Address,Name\nalex@example.com,Alex",
  },
  {
    title: "Extra columns → merge tags",
    body: "Non-email columns become contact fields ({{first_name}}, {{company}}, …) for templates.",
    example: "email,first_name,plan\nalex@example.com,Alex,pro",
  },
];

function resultFromDetail(listId: number, detail: ListDetail | null, fallbackStatus = "importing"): ImportResult {
  return {
    listId,
    valid_count: detail?.valid_count ?? 0,
    invalid_count: detail?.invalid_count ?? 0,
    duplicate_count: detail?.duplicate_count ?? 0,
    suppressed_count: detail?.suppressed_count ?? 0,
    role_count: detail?.role_count ?? 0,
    status: detail?.status ?? fallbackStatus,
  };
}

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const [step, setStep] = useState<Step>(0);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [consentText, setConsentText] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [excludeRoles, setExcludeRoles] = useState(true);
  const [checkDomains, setCheckDomains] = useState(true);
  const [emailColumn, setEmailColumn] = useState("");
  const [preview, setPreview] = useState<ListPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [watchingListId, setWatchingListId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  function reset() {
    setStep(0);
    setFile(null);
    setName("");
    setSourceLabel("");
    setConsentText("");
    setConsentConfirmed(false);
    setExcludeRoles(true);
    setCheckDomains(true);
    setEmailColumn("");
    setPreview(null);
    setPreviewError(null);
    setPreviewing(false);
    setResult(null);
    setProgress(null);
    setWatchingListId(null);
    setBusy(false);
    setDragOver(false);
  }

  useStreamEvent("import", (event) => {
    if (watchingListId === null || event.listId !== watchingListId) return;
    setProgress({
      phase: event.phase,
      rowsProcessed: event.rowsProcessed,
      domainsChecked: event.domainsChecked,
      domainsTotal: event.domainsTotal,
      error: event.error,
    });
    if (event.phase === "done" || event.phase === "failed") {
      void (async () => {
        let detail: ListDetail | null = null;
        try {
          detail = await api.get<ListDetail>(`/api/lists/${event.listId}`);
        } catch {
          detail = null;
        }
        setResult(
          resultFromDetail(
            event.listId,
            detail,
            event.phase === "failed" ? "failed" : "ready",
          ),
        );
        if (event.counts) {
          setResult((prev) =>
            prev
              ? {
                  ...prev,
                  valid_count: event.counts?.valid ?? prev.valid_count,
                  invalid_count: event.counts?.invalid ?? prev.invalid_count,
                  duplicate_count: event.counts?.duplicate ?? prev.duplicate_count,
                  suppressed_count: event.counts?.suppressed ?? prev.suppressed_count,
                  role_count: event.counts?.role ?? prev.role_count,
                  status: event.phase === "failed" ? "failed" : "ready",
                }
              : prev,
          );
        }
        void client.invalidateQueries({ queryKey: queryKeys.lists });
        setWatchingListId(null);
        if (event.phase === "failed") {
          toast.error(event.error || "Import failed");
        } else {
          toast.success("Import finished");
        }
      })();
    }
  });

  const onFile = useCallback(async (next: File | null) => {
    setFile(next);
    setPreview(null);
    setPreviewError(null);
    setResult(null);
    setProgress(null);
    if (!next) return;
    try {
      assertUploadSize(next);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "File is too large");
      setStep(1);
      return;
    }
    setName((prev) => prev || next.name.replace(/\.(csv|tsv|txt)$/i, "") || "Audience");
    setPreviewing(true);
    try {
      const p = await previewListCsv(next);
      setPreview(p);
      const header = p.headers[p.emailColumn];
      setEmailColumn(p.headerless ? `#${p.emailColumn}` : header || `#${p.emailColumn}`);
      setStep(2);
    } catch (err) {
      setPreviewError(isApiError(err) ? err.message : "Could not preview this file");
      setStep(1);
    } finally {
      setPreviewing(false);
    }
  }, []);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0] ?? null;
    if (dropped) void onFile(dropped);
  }

  async function submit() {
    if (!file || !consentConfirmed) return;
    setBusy(true);
    setProgress({ phase: "parsing", rowsProcessed: 0 });
    try {
      const res = await importList(file, {
        name: name.trim() || "Audience",
        sourceLabel: sourceLabel.trim() || file.name,
        consentText: consentText.trim() || "Operator confirmed consent for this list.",
        consentConfirmed: true,
        excludeRoles,
        checkDomains,
        emailColumn: emailColumn || undefined,
      });
      void client.invalidateQueries({ queryKey: queryKeys.lists });
      let detail: ListDetail | null = null;
      try {
        detail = await api.get<ListDetail>(`/api/lists/${res.listId}`);
      } catch {
        detail = null;
      }
      setResult(resultFromDetail(res.listId, detail, detail?.status ?? "importing"));
      setStep(3);
      if (detail?.status === "ready" || detail?.status === "failed") {
        setProgress(null);
        setWatchingListId(null);
        toast.success(detail.status === "ready" ? "Import finished" : "Import failed");
      } else {
        setWatchingListId(res.listId);
        toast.success("Import started");
      }
    } catch (err) {
      setProgress(null);
      toast.error(isApiError(err) ? err.message : err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const canContinueFromUpload = Boolean(file && preview && !previewError);
  const canImport = Boolean(file && preview && consentConfirmed && !result);
  const maxMb = UPLOAD_MAX_BYTES / (1024 * 1024);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className={cn("max-w-3xl", wizardPanelClass)}>
        <DialogHeader className="mx-0 mt-0">
          <DialogTitle>Import audience</DialogTitle>
          <DialogDescription>
            Walk through allowed file shapes, upload, map the email column, confirm consent.
          </DialogDescription>
          <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="Import steps">
            {STEPS.map((label, i) => {
              const active = step === i;
              const done = step > i;
              return (
                <li
                  key={label}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    active ? "border-primary bg-primary-subtle text-primary" : null,
                    done ? "border-border text-foreground" : null,
                    !active && !done ? "border-border text-muted-foreground" : null,
                  )}
                >
                  {done ? <Check className="h-3 w-3" aria-hidden /> : <span className="tabular">{i + 1}</span>}
                  {label}
                </li>
              );
            })}
          </ol>
        </DialogHeader>

        <DialogBody>
          {/* Always mounted so tests / keyboard can attach a file from any step. */}
          <Input
            id="import-file"
            type="file"
            accept={ACCEPTED}
            data-testid="import-file"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />

          {step === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-secondary-foreground">
                Archer parses plain delimited text only (UTF-8). Excel <code className="text-xs">.xlsx</code> is not
                supported — export CSV/TSV first. Max file size {maxMb}&nbsp;MB. Preview uses the first 64&nbsp;KB; the
                full file imports after consent.
              </p>
              <ul className="flex flex-col gap-2">
                {SCHEMAS.map((s) => (
                  <li key={s.title} className="rounded-md border border-border px-3 py-2.5">
                    <p className="text-sm font-medium text-foreground">{s.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.body}</p>
                    <pre className="mt-2 overflow-x-auto rounded bg-zinc-50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-secondary-foreground">
                      {s.example}
                    </pre>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {step === 1 || (step === 2 && !preview && previewing) ? (
            <div className="flex flex-col gap-3">
              <div
                role="button"
                tabIndex={0}
                data-testid="import-dropzone"
                className={cn(
                  "flex min-h-[9rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center transition-colors",
                  dragOver ? "border-primary bg-primary-subtle" : "border-border bg-zinc-50/80",
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    document.getElementById("import-file")?.click();
                  }
                }}
                onClick={() => document.getElementById("import-file")?.click()}
              >
                <FileSpreadsheet className="h-7 w-7 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium text-foreground">
                  {previewing ? "Reading file…" : "Drop CSV / TSV here, or click to browse"}
                </p>
                <p className="text-xs text-muted-foreground">.csv · .tsv · .txt · UTF-8 · max {maxMb} MB</p>
              </div>
              {file ? (
                <p className="text-xs text-muted-foreground">
                  Selected · <span className="font-medium text-foreground">{file.name}</span>
                  {preview ? ` · delimiter “${preview.delimiter === "\t" ? "tab" : preview.delimiter}”` : null}
                  {preview?.headerless ? " · headerless" : null}
                </p>
              ) : null}
              {previewError ? (
                <p role="alert" className="text-sm text-destructive">
                  {previewError}
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 2 && preview ? (
            <div className="flex flex-col gap-3">
              <FieldRow id="import-name" label="List name">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </FieldRow>
              <FieldRow id="import-source" label="Source label">
                <Input
                  value={sourceLabel}
                  onChange={(e) => setSourceLabel(e.target.value)}
                  placeholder="Where these addresses came from"
                />
              </FieldRow>
              <FieldRow id="import-consent" label="Consent attestation">
                <Textarea value={consentText} onChange={(e) => setConsentText(e.target.value)} rows={2} />
              </FieldRow>
              <FieldRow id="import-email-col" label="Email column">
                <Select value={emailColumn} onValueChange={setEmailColumn}>
                  <SelectTrigger id="import-email-col" aria-label="Email column">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {preview.headers.map((h, i) => (
                      <SelectItem key={`${h}-${i}`} value={preview.headerless ? `#${i}` : h || `#${i}`}>
                        {preview.headerless ? `Column ${i + 1}` : h || `Column ${i + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              <div className="min-w-0 max-w-full overflow-x-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {preview.headers.map((h, i) => (
                        <TableHead key={`${h}-${i}`}>
                          {preview.headerless ? `Col ${i + 1}` : h || `Col ${i + 1}`}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((row, ri) => (
                      <TableRow key={ri}>
                        {row.map((cell, ci) => (
                          <TableCell key={ci}>{cell}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="import-consent-ok"
                  checked={consentConfirmed}
                  onCheckedChange={(v) => setConsentConfirmed(v === true)}
                />
                <Label htmlFor="import-consent-ok" className="text-sm font-normal leading-snug">
                  Every address on this list consented to receive email from me.
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="import-roles"
                  checked={excludeRoles}
                  onCheckedChange={(v) => setExcludeRoles(v === true)}
                />
                <Label htmlFor="import-roles" className="text-sm font-normal leading-snug">
                  Exclude role addresses (info@, admin@, …)
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="import-domains"
                  checked={checkDomains}
                  onCheckedChange={(v) => setCheckDomains(v === true)}
                />
                <Label htmlFor="import-domains" className="text-sm font-normal leading-snug">
                  Check domains (MX) — slower on huge lists with many unique domains
                </Label>
              </div>
            </div>
          ) : null}

          {step === 3 && result ? (
            <div className="rounded-md border border-border p-3 text-sm" data-testid="import-result">
              <p className="font-medium text-foreground">
                {result.status === "ready"
                  ? `Import finished (list #${result.listId})`
                  : result.status === "failed"
                    ? `Import failed (list #${result.listId})`
                    : `Import running (list #${result.listId})`}
              </p>
              {progress && result.status === "importing" ? (
                <p className="mt-2 text-xs text-muted-foreground" data-testid="import-progress">
                  {progress.phase === "checking_domains"
                    ? `Checking domains ${progress.domainsChecked ?? 0}/${progress.domainsTotal ?? "…"}`
                    : progress.phase === "parsing"
                      ? `Parsing rows${progress.rowsProcessed != null ? ` · ${progress.rowsProcessed.toLocaleString()} processed` : "…"}`
                      : progress.phase}
                </p>
              ) : null}
              {progress?.error ? (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {progress.error}
                </p>
              ) : null}
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary-foreground">
                <li>
                  Imported <span className="font-semibold tabular text-foreground">{result.valid_count}</span>
                </li>
                <li>
                  Invalid <span className="font-semibold tabular text-foreground">{result.invalid_count}</span>
                </li>
                <li>
                  Duplicates <span className="font-semibold tabular text-foreground">{result.duplicate_count}</span>
                </li>
                <li>
                  Suppressed <span className="font-semibold tabular text-foreground">{result.suppressed_count}</span>
                </li>
                <li>
                  Roles <span className="font-semibold tabular text-foreground">{result.role_count}</span>
                </li>
                <li>
                  Status <span className="font-semibold text-foreground">{result.status}</span>
                </li>
              </ul>
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter className="mx-0 mb-0">
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Close
          </Button>
          {step > 0 && step < 3 ? (
            <Button
              variant="secondary"
              onClick={() => setStep((s) => (s > 0 ? ((s - 1) as Step) : s))}
              disabled={busy || previewing}
            >
              <ChevronLeft aria-hidden="true" />
              Back
            </Button>
          ) : null}
          {step === 0 ? (
            <Button onClick={() => setStep(1)}>
              Continue
              <ChevronRight aria-hidden="true" />
            </Button>
          ) : null}
          {step === 1 ? (
            <Button onClick={() => setStep(2)} disabled={!canContinueFromUpload || previewing}>
              Continue
              <ChevronRight aria-hidden="true" />
            </Button>
          ) : null}
          {step === 2 ? (
            <Button onClick={() => void submit()} loading={busy} disabled={!canImport}>
              {busy ? null : <Upload aria-hidden="true" />}
              Import
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
