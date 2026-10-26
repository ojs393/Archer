import { Trash2 } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { ListRow } from "@/lib/types";

export function ListsTable({
  rows,
  selectedId,
  onSelect,
  onDelete,
}: {
  rows: ListRow[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Recipients</TableHead>
          <TableHead>Suppressed</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="w-[4rem] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            data-state={selectedId === row.id ? "selected" : undefined}
            className="cursor-pointer"
            tabIndex={0}
            onClick={() => onSelect(row.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(row.id);
              }
            }}
          >
            <TableCell className="font-medium">
              <span className="mr-2">{row.name}</span>
              {row.status !== "ready" ? (
                <Badge variant={row.status === "failed" ? "destructive" : "secondary"}>{row.status}</Badge>
              ) : null}
            </TableCell>
            <TableCell className="tabular">{formatNumber(row.valid_count)}</TableCell>
            <TableCell className="tabular">{formatNumber(row.suppressed_count)}</TableCell>
            <TableCell>{formatDateTime(row.created_at)}</TableCell>
            <TableCell>
              <div className="flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <IconButton label="Delete" icon={Trash2} destructive onClick={() => onDelete(row.id)} />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
