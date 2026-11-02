import { Ban, ChevronLeft, ChevronRight, Pencil, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { FolderField } from "@/components/FolderField";
import { IconButton } from "@/components/IconButton";
import { TagEditor } from "@/components/TagEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { isEmail } from "@/components/setup/draft";
import { isApiError } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { isFolderTag } from "@/lib/folders";
import { humanizeKey, plainValue } from "@/lib/humanize";
import {
  useDeleteContact,
  useList,
  useListContacts,
  useSuppressContact,
  useUpdateContact,
  useUpdateList,
} from "@/lib/queries/lists";
import { useTags } from "@/lib/queries/tags";
import type { ContactView } from "@/lib/types";

const PAGE = 50;

export function ListDetail({ listId }: { listId: number }) {
  const detail = useList(listId);
  const tagsCatalog = useTags();
  const updateList = useUpdateList();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"id" | "email" | "domain">("id");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [offset, setOffset] = useState(0);
  const contacts = useListContacts(listId, { q, sort, order, limit: PAGE, offset });
  const deleteContact = useDeleteContact(listId);
  const suppressContact = useSuppressContact(listId);
  const updateContact = useUpdateContact(listId);

  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [edit, setEdit] = useState<ContactView | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editFields, setEditFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!detail.data) return;
    setName(detail.data.name);
    setSource(detail.data.source_label);
    setTags(detail.data.tags);
  }, [detail.data]);

  useEffect(() => {
    setOffset(0);
  }, [listId, q, sort, order]);

  const list = detail.data;
  const page = contacts.data;
  const total = page?.total ?? 0;

  async function saveMeta() {
    if (!name.trim()) {
      toast.error("Enter a list name.");
      return;
    }
    if (!source.trim()) {
      toast.error("Enter a source label.");
      return;
    }
    try {
      await updateList.mutateAsync({ id: listId, name: name.trim(), source_label: source.trim(), tags });
      toast.success("List updated");
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Could not update list");
    }
  }

  function openEdit(c: ContactView) {
    setEdit(c);
    setEditEmail(c.email);
    setEditFields({ ...c.fields });
  }

  async function saveContact() {
    if (!edit) return;
    if (!isEmail(editEmail)) {
      toast.error("Enter a valid email address.");
      return;
    }
    try {
      await updateContact.mutateAsync({ contactId: edit.id, email: editEmail.trim(), fields: editFields });
      toast.success("Contact updated");
      setEdit(null);
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Could not update contact");
    }
  }

  if (detail.isPending) {
    return (
      <div className="space-y-2 border-t border-border p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!list) {
    return (
      <div className="border-t border-border">
        <EmptyState
          icon={Ban}
          title="Could not load list detail"
          action={{ label: "Retry", icon: RotateCw, onClick: () => void detail.refetch() }}
        />
      </div>
    );
  }

  const columns = page?.columns ?? list.columns;

  return (
    <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`list-name-${listId}`}>Name</Label>
          <Input id={`list-name-${listId}`} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`list-source-${listId}`}>Source label</Label>
          <Input id={`list-source-${listId}`} value={source} onChange={(e) => setSource(e.target.value)} />
        </div>
      </div>
      <FolderField tags={tags} onChange={setTags} catalog={tagsCatalog.data ?? []} id={`list-folder-${listId}`} />
      <div className="flex flex-col gap-1.5">
        <Label>Tags</Label>
        <TagEditor
          value={tags.filter((t) => !isFolderTag(t))}
          onChange={(next) => {
            const folder = tags.find(isFolderTag);
            setTags(folder ? [...next, folder] : next);
          }}
          suggestions={(tagsCatalog.data ?? []).map((t) => t.name).filter((n) => !isFolderTag(n))}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Created {formatDateTime(list.created_at)} · {formatNumber(list.valid_count)} recipients
        </p>
        <Button type="button" size="sm" loading={updateList.isPending} onClick={() => void saveMeta()}>
          Save list
        </Button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm font-medium text-foreground">Contacts</p>
        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-xs"
            placeholder="Search contacts…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search contacts"
          />
          <Select
            value={`${sort}:${order}`}
            onValueChange={(v) => {
              const [s, o] = v.split(":") as ["id" | "email" | "domain", "asc" | "desc"];
              setSort(s);
              setOrder(o);
            }}
          >
            <SelectTrigger className="w-[10rem]" aria-label="Sort contacts">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="id:asc">ID ↑</SelectItem>
              <SelectItem value="id:desc">ID ↓</SelectItem>
              <SelectItem value="email:asc">Email A–Z</SelectItem>
              <SelectItem value="email:desc">Email Z–A</SelectItem>
              <SelectItem value="domain:asc">Domain A–Z</SelectItem>
              <SelectItem value="domain:desc">Domain Z–A</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {contacts.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : contacts.isError ? (
        <EmptyState
          icon={Ban}
          title="Could not load contacts"
          action={{ label: "Retry", icon: RotateCw, onClick: () => void contacts.refetch() }}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  {columns.map((c) => (
                    <TableHead key={c}>{humanizeKey(c)}</TableHead>
                  ))}
                  <TableHead className="w-[7rem] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(page?.contacts ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.email}</TableCell>
                    {columns.map((col) => (
                      <TableCell key={col} className="max-w-[14rem] truncate text-secondary-foreground">
                        {plainValue(c.fields[col])}
                      </TableCell>
                    ))}
                    <TableCell>
                      <div className="flex justify-end gap-0.5">
                        <IconButton label="Edit" icon={Pencil} onClick={() => openEdit(c)} />
                        <IconButton
                          label="Suppress"
                          icon={Ban}
                          onClick={() => {
                            void suppressContact.mutateAsync(c.id).then(
                              () => toast.success("Added to suppression"),
                              (err) => toast.error(isApiError(err) ? err.message : "Suppress failed"),
                            );
                          }}
                        />
                        <IconButton
                          label="Delete"
                          icon={Trash2}
                          destructive
                          onClick={() => {
                            void deleteContact.mutateAsync(c.id).then(
                              () => toast.success("Contact deleted"),
                              (err) => toast.error(isApiError(err) ? err.message : "Delete failed"),
                            );
                          }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {formatNumber(Math.min(offset + 1, total))}–{formatNumber(Math.min(offset + PAGE, total))} of {formatNumber(total)}
            </p>
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="secondary" disabled={offset <= 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                <ChevronLeft aria-hidden="true" />
                Prev
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={offset + PAGE >= total}
                onClick={() => setOffset(offset + PAGE)}
              >
                Next
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={edit !== null} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit contact</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
            </div>
            {Object.keys(editFields).map((key) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Label htmlFor={`edit-field-${key}`}>{humanizeKey(key)}</Label>
                <Input
                  id={`edit-field-${key}`}
                  value={editFields[key] ?? ""}
                  onChange={(e) => setEditFields((f) => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button type="button" loading={updateContact.isPending} onClick={() => void saveContact()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
