import { Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FieldRow } from "@/components/FieldRow";
import { Button } from "@/components/ui/button";
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
import { InfoHint } from "@/components/ui/InfoHint";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { isApiError } from "@/lib/api";
import { useSettings } from "@/lib/queries";
import { useCreateTemplate, useTemplate, useTemplatePreview, useUpdateTemplate } from "@/lib/queries/templates";
import { cn } from "@/lib/utils";
import { EmailPreview } from "./EmailPreview";

const VARS_HINT =
  "Built-in: email, first_name, company (via columns), domain, unsubscribe_url, postal_address, today. Use {{var}} in subject and HTML.";

export function TemplateEditor({
  open,
  onOpenChange,
  templateId,
  readOnly = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: number | null;
  /** View-only: show rendered email without edit fields. */
  readOnly?: boolean;
}) {
  const existing = useTemplate(templateId, open && templateId !== null);
  const serverPreview = useTemplatePreview(templateId, null, open && readOnly && templateId !== null);
  const settings = useSettings(open);
  const create = useCreateTemplate();
  const update = useUpdateTemplate();

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const seededFor = useRef<number | "new" | null>(null);

  useEffect(() => {
    if (!open) {
      seededFor.current = null;
      return;
    }
    if (templateId === null) {
      if (seededFor.current === "new") return;
      setName("");
      setSubject("");
      setHtml("<p>Hello {{first_name}},</p>\n<p>{{unsubscribe_url}}</p>\n<p>{{postal_address}}</p>");
      setError(null);
      seededFor.current = "new";
      return;
    }
    if (!existing.data || seededFor.current === templateId) return;
    setName(existing.data.name);
    setSubject(existing.data.subject);
    setHtml(existing.data.html);
    setError(null);
    seededFor.current = templateId;
  }, [open, templateId, existing.data]);

  const saving = create.isPending || update.isPending;

  async function save() {
    setError(null);
    if (!name.trim() || !subject.trim() || !html.trim()) {
      setError("Name, subject, and HTML are required.");
      return;
    }
    try {
      if (templateId === null) {
        await create.mutateAsync({ name: name.trim(), subject: subject.trim(), html });
        toast.success("Template created");
      } else {
        await update.mutateAsync({ id: templateId, body: { name: name.trim(), subject: subject.trim(), html } });
        toast.success("Template saved");
      }
      onOpenChange(false);
    } catch (err) {
      const message = isApiError(err) ? err.message : "Could not save template";
      setError(message);
      toast.error(message);
    }
  }

  const sender = settings.data ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-5xl", wizardPanelClass)}>
        <DialogHeader className="mx-0 mt-0">
          <DialogTitle>
            {readOnly ? "View template" : templateId === null ? "New template" : "Edit template"}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1">
            {readOnly
              ? "Server-rendered preview with sender + sample contact merges."
              : "HTML body with merge tags. Live preview fills samples from Settings."}
            {!readOnly ? <InfoHint label="Available variables">{VARS_HINT}</InfoHint> : null}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {readOnly ? (
            existing.isPending && !existing.data ? (
              <Skeleton className="h-[28rem] w-full" />
            ) : (
              <EmailPreview
                subject={serverPreview.data?.subject ?? (subject || existing.data?.subject || "")}
                html={serverPreview.data?.html ?? (html || existing.data?.html || "")}
                name={name || existing.data?.name}
                fromName={sender?.fromName}
                fromEmail={sender?.fromEmail}
                toEmail={serverPreview.data?.email}
                settings={sender}
                fillVars={!serverPreview.data}
              />
            )
          ) : (
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-3">
                <FieldRow id="tpl-name" label="Name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </FieldRow>
                <FieldRow id="tpl-subject" label="Subject" info="Supports {{var}} merge tags.">
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                </FieldRow>
                <FieldRow id="tpl-html" label="HTML body">
                  <Textarea
                    className="min-h-[18rem] font-mono text-[13px]"
                    value={html}
                    onChange={(e) => setHtml(e.target.value)}
                    spellCheck={false}
                  />
                </FieldRow>
                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
              <EmailPreview
                subject={subject}
                html={html}
                fromName={sender?.fromName}
                fromEmail={sender?.fromEmail}
                settings={sender}
                fillVars
              />
            </div>
          )}
        </DialogBody>

        <DialogFooter className="mx-0 mb-0">
          {readOnly ? (
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void save()} loading={saving}>
                {saving ? null : <Save aria-hidden="true" />}
                Save
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
