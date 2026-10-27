import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FieldRow } from "@/components/FieldRow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, isApiError } from "@/lib/api";
import { importList, previewListCsv } from "@/lib/queries/lists";
import { queryKeys } from "@/lib/queryKeys";
import type { ListDetail, ListPreview } from "@/lib/types";

type ImportResult = {
  listId: number;
  valid_count: number;
  invalid_count: number;
  duplicate_count: number;
  suppressed_count: number;
  role_count: number;
  status: string;
};

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [consentText, setConsentText] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [excludeRoles, setExcludeRoles] = useState(true);
  const [emailColumn, setEmailColumn] = useState("");
  const [preview, setPreview] = useState<ListPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setFile(null);
    setName("");
    setSourceLabel("");
    setConsentText("");
    setConsentConfirmed(false);
    setExcludeRoles(true);
    setEmailColumn("");
    setPreview(null);
    setPreviewError(null);
    setResult(null);
    setBusy(false);
  }

  async function onFile(next: File | null) {
    setFile(next);
    setPreview(null);
    setPreviewError(null);
    setResult(null);
    if (!next) return;
    if (!name) setName(next.name.replace(/\.csv$/i, "") || "Audience");
    try {
      const p = await previewListCsv(next);
      setPreview(p);
      const header = p.headers[p.emailColumn];
      setEmailColumn(p.headerless ? `#${p.emailColumn}` : header || `#${p.emailColumn}`);
    } catch (err) {
      setPreviewError(isApiError(err) ? err.message : "Could not preview this CSV");
    }
  }

  async function submit() {
    if (!file || !consentConfirmed) return;
    setBusy(true);
    try {
      const res = await importList(file, {
        name: name.trim() || "Audience",
        sourceLabel: sourceLabel.trim() || file.name,
        consentText: consentText.trim() || "Operator confirmed consent for this list.",
        consentConfirmed: true,
        excludeRoles,
        emailColumn: emailColumn || undefined,
      });
      void client.invalidateQueries({ queryKey: queryKeys.lists });
      let detail: ListDetail | null = null;
      try {
        detail = await api.get<ListDetail>(`/api/lists/${res.listId}`);
      } catch {
        detail = null;
      }
      setResult({
        listId: res.listId,
        valid_count: detail?.valid_count ?? 0,
        invalid_count: detail?.invalid_count ?? 0,
        duplicate_count: detail?.duplicate_count ?? 0,
        suppressed_count: detail?.suppressed_count ?? 0,
        role_count: detail?.role_count ?? 0,
        status: detail?.status ?? "importing",
      });
      toast.success("Import started");
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import CSV</DialogTitle>
          <DialogDescription>Upload a CSV, map the email column, and confirm consent.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <FieldRow id="import-file" label="CSV file">
            <Input type="file" accept=".csv,text/csv" data-testid="import-file" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
          </FieldRow>
          <FieldRow id="import-name" label="List name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </FieldRow>
          <FieldRow id="import-source" label="Source label">
            <Input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="Where these addresses came from" />
          </FieldRow>
          <FieldRow id="import-consent" label="Consent attestation">
            <Textarea value={consentText} onChange={(e) => setConsentText(e.target.value)} rows={3} />
          </FieldRow>

          {previewError ? (
            <p role="alert" className="text-sm text-destructive">
              {previewError}
            </p>
          ) : null}

          {preview ? (
            <div className="flex flex-col gap-3">
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
              <div className="min-w-0 max-w-full rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {preview.headers.map((h, i) => (
                        <TableHead key={`${h}-${i}`}>{preview.headerless ? `Col ${i + 1}` : h || `Col ${i + 1}`}</TableHead>
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
            </div>
          ) : null}

          <div className="flex items-start gap-2">
            <Checkbox id="import-consent-ok" checked={consentConfirmed} onCheckedChange={(v) => setConsentConfirmed(v === true)} />
            <Label htmlFor="import-consent-ok" className="text-sm font-normal leading-snug">
              Every address on this list consented to receive email from me.
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="import-roles" checked={excludeRoles} onCheckedChange={(v) => setExcludeRoles(v === true)} />
            <Label htmlFor="import-roles" className="text-sm font-normal leading-snug">
              Exclude role addresses (info@, admin@, …)
            </Label>
          </div>

          {result ? (
            <div className="rounded-md border border-border p-3 text-sm" data-testid="import-result">
              <p className="font-medium text-foreground">Import queued (list #{result.listId})</p>
              <ul className="mt-2 grid grid-cols-2 gap-1 text-secondary-foreground sm:grid-cols-3">
                <li>Imported: {result.valid_count}</li>
                <li>Invalid: {result.invalid_count}</li>
                <li>Duplicates: {result.duplicate_count}</li>
                <li>Suppressed: {result.suppressed_count}</li>
                <li>Roles: {result.role_count}</li>
                <li>Status: {result.status}</li>
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Close
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!file || !consentConfirmed || Boolean(result)}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
