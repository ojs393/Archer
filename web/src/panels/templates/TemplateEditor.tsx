import { useEffect, useRef, useState } from "react";
import { FieldRow } from "@/components/FieldRow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InfoHint } from "@/components/ui/InfoHint";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { isApiError } from "@/lib/api";
import { useCreateTemplate, useTemplate, useUpdateTemplate } from "@/lib/queries/templates";

const VARS_HINT =
  "Built-in: email, first_name, company (via columns), domain, unsubscribe_url, postal_address, today. Use {{var}} in subject and HTML.";

export function TemplateEditor({
  open, onOpenChange, templateId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: number | null;
}) {
  const existing = useTemplate(templateId, open && templateId !== null);
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
  const previewHtml = html.slice(0, 8000);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{templateId === null ? "New template" : "Edit template"}</DialogTitle>
          <DialogDescription className="flex items-center gap-1">
            HTML body with merge tags.
            <InfoHint label="Available variables">{VARS_HINT}</InfoHint>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <FieldRow id="tpl-name" label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </FieldRow>
            <FieldRow id="tpl-subject" label="Subject" info="Supports {{var}} merge tags.">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </FieldRow>
            <FieldRow id="tpl-html" label="HTML body">
              <Textarea className="min-h-[18rem] font-mono text-[13px]" value={html} onChange={(e) => setHtml(e.target.value)} spellCheck={false} />
            </FieldRow>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">Preview</p>
            <p className="text-sm font-medium text-foreground">Subject: {subject || "—"}</p>
            {/* XSS: templates are operator-authored on localhost; not sanitised for the preview pane. */}
            <div className="max-h-[24rem] overflow-auto rounded-md border border-border bg-zinc-50 p-3">
              <div dangerouslySetInnerHTML={{ __html: previewHtml || "<p></p>" }} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
