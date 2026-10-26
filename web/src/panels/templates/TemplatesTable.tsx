import { Copy, Pencil, Trash2 } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import type { TemplateSummary } from "@/lib/types";

/** Subject is not on TemplateSummary; the editor loads the full view. */
export function TemplatesTable({
  rows, subjects, onEdit, onDuplicate, onDelete,
}: {
  rows: TemplateSummary[];
  subjects: Map<number, string>;
  onEdit: (id: number) => void;
  onDuplicate: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Subject</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="w-[7rem] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell className="max-w-[18rem] truncate text-secondary-foreground">{subjects.get(row.id) ?? "—"}</TableCell>
            <TableCell>{formatDateTime(row.updatedAt)}</TableCell>
            <TableCell>
              <div className="flex justify-end gap-0.5">
                <IconButton label="Edit" icon={Pencil} onClick={() => onEdit(row.id)} />
                <IconButton label="Duplicate" icon={Copy} onClick={() => onDuplicate(row.id)} />
                <IconButton label="Delete" icon={Trash2} destructive onClick={() => onDelete(row.id)} />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
