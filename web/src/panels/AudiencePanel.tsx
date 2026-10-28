import { RotateCw, Upload, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { FilterToolbar } from "@/components/FilterToolbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { isApiError } from "@/lib/api";
import { folderOptions, isFolderTag } from "@/lib/folders";
import { useDeleteList, useLists, type ListFilters } from "@/lib/queries/lists";
import { useTags } from "@/lib/queries/tags";
import { ImportDialog } from "./audience/ImportDialog";
import { ListDetail } from "./audience/ListDetail";
import { ListsTable } from "./audience/ListsTable";
import { PanelShell } from "./PanelShell";

export default function AudiencePanel() {
  const [filters, setFilters] = useState<ListFilters>({ sort: "id", order: "desc", status: "", tag: "", q: "" });
  const [folder, setFolder] = useState("");
  const effectiveFilters = useMemo(
    () => ({ ...filters, tag: folder || filters.tag || undefined }),
    [filters, folder],
  );
  const lists = useLists(effectiveFilters);
  const tags = useTags();
  const del = useDeleteList();
  const [importOpen, setImportOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const rows = lists.data ?? [];

  const folderOpts = useMemo(() => folderOptions(tags.data ?? []), [tags.data]);
  const tagOptions = useMemo(
    () =>
      (tags.data ?? [])
        .filter((t) => !isFolderTag(t.name))
        .map((t) => ({ value: t.name, label: `${t.name} (${t.listCount})` })),
    [tags.data],
  );

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
        <FilterToolbar
          q={filters.q ?? ""}
          onQ={(q) => setFilters((f) => ({ ...f, q }))}
          status={filters.status ?? ""}
          onStatus={(status) => setFilters((f) => ({ ...f, status: status as ListFilters["status"] }))}
          statusOptions={[
            { value: "ready", label: "Ready" },
            { value: "importing", label: "Importing" },
            { value: "failed", label: "Failed" },
          ]}
          folder={folder}
          onFolder={(v) => {
            setFolder(v);
            if (v) setFilters((f) => ({ ...f, tag: "" }));
          }}
          folderOptions={folderOpts}
          tag={filters.tag ?? ""}
          onTag={(tag) => {
            setFolder("");
            setFilters((f) => ({ ...f, tag }));
          }}
          tagOptions={tagOptions}
          sort={filters.sort ?? "id"}
          onSort={(sort) => setFilters((f) => ({ ...f, sort: sort as ListFilters["sort"] }))}
          sortOptions={[
            { value: "id", label: "Newest id" },
            { value: "name", label: "Name" },
            { value: "created_at", label: "Created" },
            { value: "valid_count", label: "Recipients" },
          ]}
          order={filters.order ?? "desc"}
          onOrder={(order) => setFilters((f) => ({ ...f, order }))}
        />
        {lists.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : lists.isError ? (
          <EmptyState
            icon={Users}
            title="Could not load lists"
            action={{ label: "Retry", icon: RotateCw, onClick: () => void lists.refetch() }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={
              filters.q || filters.status || filters.tag || folder
                ? "No lists match these filters."
                : "Import a CSV to build your first audience."
            }
            action={
              filters.q || filters.status || filters.tag || folder
                ? undefined
                : { label: "Import CSV", onClick: () => setImportOpen(true), icon: Upload }
            }
          />
        ) : (
          <>
            <ListsTable rows={rows} selectedId={selectedId} onSelect={setSelectedId} onDelete={setDeleteId} />
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
