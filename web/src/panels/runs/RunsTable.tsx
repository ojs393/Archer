import { Eye, Pause, Play, Square } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { StatusPill } from "@/components/StatusPill";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { campaignProgress } from "@/lib/campaignProgress";
import { formatDateTime } from "@/lib/format";
import { folderLabel, isFolderTag } from "@/lib/folders";
import type { CampaignView } from "@/lib/types";

const ACTIVE = new Set(["running", "waiting_window", "waiting_network"]);
const PAUSED = new Set(["paused", "safety_stop"]);

export function campaignLabel(c: CampaignView, lists?: Map<number, string>, templates?: Map<number, string>): string {
  if (c.displayName) return c.displayName;
  const list = lists?.get(c.listId) ?? c.listName ?? `List ${c.listId}`;
  const template = templates?.get(c.templateId) ?? c.templateName ?? `Template ${c.templateId}`;
  return `${list} · ${template}`;
}

function tagLabel(t: string): string {
  return isFolderTag(t) ? `Folder · ${folderLabel(t)}` : t;
}

export function RunsTable({
  rows,
  lists,
  templates,
  selectedId,
  busyId,
  onSelect,
  onStart,
  onPause,
  onResume,
  onCancel,
}: {
  rows: CampaignView[];
  lists: Map<number, string>;
  templates: Map<number, string>;
  selectedId: number | null;
  busyId: number | null;
  onSelect: (id: number) => void;
  onStart: (id: number) => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
  onCancel: (id: number) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Tags</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Progress</TableHead>
          <TableHead>Started</TableHead>
          <TableHead className="w-[10rem] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const progress = campaignProgress(row.counts);
          const canStart = row.status === "draft";
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
                <div className="flex flex-wrap gap-1">
                  {(row.tags ?? []).length ? (
                    row.tags.map((t) => (
                      <Badge key={t} size="sm" variant={isFolderTag(t) ? "solid" : "default"}>
                        {tagLabel(t)}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <StatusPill status={row.status} detail={row.pauseReason} />
              </TableCell>
              <TableCell className="min-w-[10rem]">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{progress.label}</span>
                  <Progress
                    value={progress.done}
                    max={progress.total || 1}
                    live={ACTIVE.has(row.status)}
                    aria-label={`Progress ${progress.label}`}
                  />
                </div>
              </TableCell>
              <TableCell>{formatDateTime(row.startedAt)}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  {/* Only render actions that apply to this status — Start and Resume never both show. */}
                  {canStart ? (
                    <IconButton label="Start" icon={Play} disabled={busy} onClick={() => onStart(row.id)} />
                  ) : null}
                  {canPause ? (
                    <IconButton label="Pause" icon={Pause} disabled={busy} onClick={() => onPause(row.id)} />
                  ) : null}
                  {canResume ? (
                    <IconButton label="Resume" icon={Play} disabled={busy} onClick={() => onResume(row.id)} />
                  ) : null}
                  {canCancel ? (
                    <IconButton label="Cancel" icon={Square} destructive disabled={busy} onClick={() => onCancel(row.id)} />
                  ) : null}
                  <IconButton label="Preview" icon={Eye} onClick={() => onSelect(row.id)} />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
