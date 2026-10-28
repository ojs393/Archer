import { FileText, Plus, RotateCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { api, isApiError } from "@/lib/api";
import { useDeleteTemplate, useDuplicateTemplate, useTemplates } from "@/lib/queries/templates";
import type { TemplateView } from "@/lib/types";
import { PanelShell } from "./PanelShell";
import { TemplateEditor } from "./templates/TemplateEditor";
import { TemplatesTable } from "./templates/TemplatesTable";

export default function TemplatesPanel() {
  const templates = useTemplates();
  const duplicate = useDuplicateTemplate();
  const del = useDeleteTemplate();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [subjects, setSubjects] = useState<Map<number, string>>(new Map());

  /** Depend on query data directly — `data ?? []` would be a new [] every render while loading. */
  const allRows = templates.data;
  const rows = useMemo(() => {
    if (!allRows) return allRows;
    const needle = q.trim().toLowerCase();
    if (!needle) return allRows;
    return allRows.filter((row) => {
      const subject = (subjects.get(row.id) ?? "").toLowerCase();
      return row.name.toLowerCase().includes(needle) || subject.includes(needle);
    });
  }, [allRows, q, subjects]);

  useEffect(() => {
    let cancelled = false;
    async function loadSubjects() {
      if (!allRows || allRows.length === 0) {
        setSubjects(new Map());
        return;
      }
      const entries = await Promise.all(
        allRows.map(async (row) => {
          try {
            const view = await api.get<TemplateView>(`/api/templates/${row.id}`);
            return [row.id, view.subject] as const;
          } catch {
            return [row.id, ""] as const;
          }
        }),
      );
      if (!cancelled) setSubjects(new Map(entries));
    }
    void loadSubjects();
    return () => {
      cancelled = true;
    };
  }, [allRows]);

  function openNew() {
    setEditId(null);
    setViewOnly(false);
    setEditorOpen(true);
  }

  function openEdit(id: number) {
    setEditId(id);
    setViewOnly(false);
    setEditorOpen(true);
  }

  function openView(id: number) {
    setEditId(id);
    setViewOnly(true);
    setEditorOpen(true);
  }

  async function onDuplicate(id: number) {
    try {
      await duplicate.mutateAsync(id);
      toast.success("Template duplicated");
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Could not duplicate");
    }
  }

  async function confirmDelete() {
    if (deleteId === null) return;
    try {
      await del.mutateAsync(deleteId);
      toast.success("Template deleted");
      setDeleteId(null);
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Could not delete template");
    }
  }

  return (
    <PanelShell
      title="Templates"
      actions={
        <Button onClick={openNew}>
          <Plus aria-hidden="true" />
          New template
        </Button>
      }
    >
      <Card className="shadow-card ring-1 ring-black/[0.03]">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Input
            className="max-w-xs"
            placeholder="Search templates…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search templates"
          />
        </div>
        {templates.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : templates.isError ? (
          <EmptyState
            icon={FileText}
            title="Could not load templates"
            action={{ label: "Retry", icon: RotateCw, onClick: () => void templates.refetch() }}
          />
        ) : !allRows || allRows.length === 0 ? (
          <EmptyState icon={FileText} title="No templates yet" action={{ label: "New template", onClick: openNew, icon: Plus }} />
        ) : !rows || rows.length === 0 ? (
          <EmptyState icon={FileText} title="No templates match" />
        ) : (
          <TemplatesTable
            rows={rows}
            subjects={subjects}
            onView={openView}
            onEdit={openEdit}
            onDuplicate={(id) => void onDuplicate(id)}
            onDelete={setDeleteId}
          />
        )}
      </Card>

      <TemplateEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        templateId={editId}
        readOnly={viewOnly}
      />

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title="Delete this template?"
        description="Campaigns that used this template must be deleted first."
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </PanelShell>
  );
}
