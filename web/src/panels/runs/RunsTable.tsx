import { Eye, Pause, Play, Square } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { StatusPill } from "@/components/StatusPill";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { CampaignView } from "@/lib/types";

const ACTIVE = new Set(["running", "waiting_window", "waiting_network"]);
const PAUSED = new Set(["paused", "safety_stop"]);

export function campaignLabel(c: CampaignView, lists: Map<number, string>, templates: Map<number, string>): string {
  const list = lists.get(c.listId) ?? `List ${c.listId}`;
  const template = templates.get(c.templateId) ?? `Template ${c.templateId}`;
  return `${list} · ${template}`;
}

export function RunsTable({
  rows, lists, templates, selectedId, busyId, onSelect, onPause, onResume, onCancel,
}: {
  rows: CampaignView[];
  lists: Map<number, string>;
  templates: Map<number, string>;
  selectedId: number | null;
  busyId: number | null;
  onSelect: (id: number) => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
  onCancel: (id: number) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Progress</TableHead>
          <TableHead>Started</TableHead>
          <TableHead className="w-[9rem] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const sent = row.counts.sent;
          const total = row.counts.total;
          const canPause = ACTIVE.has(row.status);
          const canResume = PAUSED.has(row.status);
          const canCancel = row.status !== "completed" && row.status !== "stopped";
          const busy = busyId === row.id;
          return (
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
              <TableCell className="font-medium">{campaignLabel(row, lists, templates)}</TableCell>
              <TableCell>
                <StatusPill status={row.status} detail={row.pauseReason} />
              </TableCell>
              <TableCell className="min-w-[10rem]">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">
                    {formatNumber(sent)}/{formatNumber(total)}
                  </span>
                  <Progress value={sent} max={total || 1} aria-label={`Progress ${sent} of ${total}`} />
                </div>
              </TableCell>
              <TableCell>{formatDateTime(row.startedAt)}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <IconButton label="Pause" icon={Pause} disabled={!canPause || busy} onClick={() => onPause(row.id)} />
                  <IconButton label="Resume" icon={Play} disabled={!canResume || busy} onClick={() => onResume(row.id)} />
                  <IconButton label="Cancel" icon={Square} destructive disabled={!canCancel || busy} onClick={() => onCancel(row.id)} />
                  <IconButton label="Open details" icon={Eye} onClick={() => onSelect(row.id)} />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
