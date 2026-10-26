import { FileText, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [subjects, setSubjects] = useState<Map<number, string>>(new Map());

  /** Depend on query data directly — `data ?? []` would be a new [] every render while loading. */
  const rows = templates.data;

  useEffect(() => {
    let cancelled = false;
    async function loadSubjects() {
      if (!rows || rows.length === 0) {
        setSubjects(new Map());
        return;
      }
      const entries = await Promise.all(
        rows.map(async (row) => {
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
  }, [rows]);

  function openNew() {
    setEditId(null);
    setEditorOpen(true);
  }

  function openEdit(id: number) {
    setEditId(id);
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
      <Card>
        {templates.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : templates.isError ? (
          <EmptyState icon={FileText} title="Could not load templates" />
        ) : !rows || rows.length === 0 ? (
          <EmptyState icon={FileText} title="No templates yet" action={{ label: "New template", onClick: openNew, icon: Plus }} />
        ) : (
          <TemplatesTable
            rows={rows}
            subjects={subjects}
            onEdit={openEdit}
            onDuplicate={(id) => void onDuplicate(id)}
            onDelete={setDeleteId}
          />
        )}
      </Card>

      <TemplateEditor open={editorOpen} onOpenChange={setEditorOpen} templateId={editId} />

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
