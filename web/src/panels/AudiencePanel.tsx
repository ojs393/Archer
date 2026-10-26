import { Upload, Users } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { isApiError } from "@/lib/api";
import { useDeleteList, useLists } from "@/lib/queries/lists";
import { ImportDialog } from "./audience/ImportDialog";
import { ListDetail } from "./audience/ListDetail";
import { ListsTable } from "./audience/ListsTable";
import { PanelShell } from "./PanelShell";

export default function AudiencePanel() {
  const lists = useLists();
  const del = useDeleteList();
  const [importOpen, setImportOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const rows = lists.data ?? [];

  async function confirmDelete() {
    if (deleteId === null) return;
    try {
      await del.mutateAsync(deleteId);
      toast.success("List deleted");
      if (selectedId === deleteId) setSelectedId(null);
      setDeleteId(null);
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Could not delete list");
    }
  }

  return (
    <PanelShell
      title="Audience"
      actions={
        <Button onClick={() => setImportOpen(true)}>
          <Upload aria-hidden="true" />
          Import CSV
        </Button>
      }
    >
      <Card>
        {lists.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : lists.isError ? (
          <EmptyState icon={Users} title="Could not load lists" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Import a CSV to build your first audience."
            action={{ label: "Import CSV", onClick: () => setImportOpen(true), icon: Upload }}
          />
        ) : (
          <>
            <ListsTable
              rows={rows}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onDelete={setDeleteId}
            />
            {selectedId !== null ? <ListDetail listId={selectedId} /> : null}
          </>
        )}
      </Card>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title="Delete this list?"
        description="Contacts on this list are removed. Campaigns that used it must be deleted first."
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </PanelShell>
  );
}
