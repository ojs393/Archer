import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useList } from "@/lib/queries/lists";

/**
 * List detail. The HTTP API exposes list totals and extra columns, but not a
 * paginated contacts endpoint — so the “recipients” table here shows import
 * summary rows (counts / status), with a client-side filter on the labels.
 * Full per-contact browsing needs a future GET /api/lists/:id/contacts.
 */
export function ListDetail({ listId }: { listId: number }) {
  const detail = useList(listId);
  const [search, setSearch] = useState("");
  const list = detail.data;

  const rows = useMemo(() => {
    if (!list) return [];
    const items = [
      { label: "Valid recipients", value: formatNumber(list.valid_count), status: list.status },
      { label: "Invalid rows", value: formatNumber(list.invalid_count), status: list.status },
      { label: "Duplicates", value: formatNumber(list.duplicate_count), status: list.status },
      { label: "Suppressed", value: formatNumber(list.suppressed_count), status: "suppressed" },
      { label: "Role addresses", value: formatNumber(list.role_count), status: "skipped" },
      { label: "Total rows", value: formatNumber(list.total_rows), status: list.status },
    ];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) => r.label.toLowerCase().includes(q) || r.status.toLowerCase().includes(q));
  }, [list, search]);

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
      <div className="border-t border-border p-4 text-sm text-destructive" role="alert">
        Could not load list detail.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{list.name}</p>
          <p className="text-xs text-muted-foreground">
            Created {formatDateTime(list.created_at)}
            {list.columns.length ? ` · Columns: ${list.columns.join(", ")}` : ""}
          </p>
          {list.error ? <p className="mt-1 text-xs text-destructive">{list.error}</p> : null}
        </div>
        <Input
          className="max-w-xs"
          placeholder="Search counts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search list summary"
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead>Count</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <TableCell className="tabular">{row.value}</TableCell>
              <TableCell className="capitalize">{row.status}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Per-contact email / first_name / company browsing is not available via the API yet; counts above come from the import.
      </p>
    </div>
  );
}
