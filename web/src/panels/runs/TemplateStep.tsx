import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useTemplate, useTemplatePreview } from "@/lib/queries/templates";
import type { TemplateSummary } from "@/lib/types";

const PREVIEW_CHARS = 500;

export function TemplateStep({
  templates, templateId, listId, onTemplateIdChange,
}: {
  templates: TemplateSummary[];
  templateId: number | null;
  listId: number | null;
  onTemplateIdChange: (id: number | null) => void;
}) {
  const detail = useTemplate(templateId);
  const preview = useTemplatePreview(templateId, listId, templateId !== null);
  const unresolved = detail.data?.analysis.validation.unresolved ?? [];
  const needsFallback = detail.data?.analysis.validation.needsFallback ?? [];
  const html = preview.data?.html ?? "";
  const snippet = html.length > PREVIEW_CHARS ? `${html.slice(0, PREVIEW_CHARS)}…` : html;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="run-template">Template</Label>
        {templates.length === 0 ? (
          <p className="text-sm text-secondary-foreground">No templates yet. Create one under Templates.</p>
        ) : (
          <Select value={templateId !== null ? String(templateId) : ""} onValueChange={(v) => onTemplateIdChange(Number(v))}>
            <SelectTrigger id="run-template" aria-label="Template">
              <SelectValue placeholder="Select a template" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {templateId !== null ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-xs font-medium text-muted-foreground">Preview</p>
          {preview.isPending || detail.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">
                Subject: {preview.data?.subject ?? detail.data?.subject ?? "—"}
              </p>
              {/* XSS: operator-authored HTML on localhost; not sanitised. */}
              <div
                className="max-h-48 overflow-auto rounded-md bg-zinc-50 p-3 text-sm"
                dangerouslySetInnerHTML={{ __html: snippet || "<p class='text-muted-foreground'>No HTML body</p>" }}
              />
            </>
          )}
          {unresolved.length > 0 || needsFallback.length > 0 ? (
            <p role="alert" className="text-xs text-destructive">
              Template variables need attention
              {unresolved.length ? `: unresolved ${unresolved.join(", ")}` : ""}
              {needsFallback.length ? `; fallback ${needsFallback.join(", ")}` : ""}.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
