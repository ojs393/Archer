import { useMemo, useState } from "react";
import { Mail, RotateCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useCampaignSends, useRequeueUncertain } from "@/lib/queries/campaigns";
import type { SendRowState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SummaryStrip } from "./SummaryStrip";
import type { CampaignView } from "@/lib/types";

const STATES: { value: SendRowState | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "uncertain", label: "Uncertain" },
  { value: "retry", label: "Retry" },
  { value: "skipped_suppressed", label: "Suppressed" },
];

const PAGE = 50;

export function CampaignSendsTab({ campaign }: { campaign: CampaignView }) {
  const [state, setState] = useState<SendRowState | "">("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const filters = useMemo(
    () => ({ state: state || undefined, q: q.trim() || undefined, limit: PAGE, offset }),
    [state, q, offset],
  );
  const sends = useCampaignSends(campaign.id, filters);
  const requeue = useRequeueUncertain();
  const rows = sends.data?.rows ?? [];
  const total = sends.data?.total ?? 0;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onRequeue() {
    try {
      const ids = selected.size ? [...selected] : undefined;
      const res = await requeue.mutateAsync({ id: campaign.id, contactIds: ids });
      toast.success(`Requeued ${res.requeued}`);
      setSelected(new Set());
      void sends.refetch();
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Could not requeue");
    }
  }

  return (
    <div className="flex flex-col gap-3 animate-in fade-in duration-300">
      <SummaryStrip campaign={campaign} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search email"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <div className="inline-flex flex-wrap rounded-md border border-border p-0.5" role="group" aria-label="Send state">
          {STATES.map((s) => (
            <button
              key={s.label}
              type="button"
              className={cn(
                "rounded px-2 py-1 text-xs font-medium transition-colors",
                state === s.value ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50",
              )}
              aria-pressed={state === s.value}
              onClick={() => {
                setState(s.value);
                setOffset(0);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="ml-auto"
          loading={requeue.isPending}
          disabled={campaign.counts.uncertain === 0}
          onClick={() => void onRequeue()}
        >
          <RotateCw aria-hidden />
          Requeue uncertain{selected.size ? ` (${selected.size})` : ""}
        </Button>
      </div>

      <Card>
        {sends.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : sends.isError ? (
          <EmptyState
            icon={Mail}
            title="Could not load sends"
            action={{ label: "Retry", icon: RotateCw, onClick: () => void sends.refetch() }}
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={Mail} title="No sends match these filters" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Email</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Last error</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.contactId}>
                  <TableCell>
                    {row.state === "uncertain" ? (
                      <input
                        type="checkbox"
                        checked={selected.has(row.contactId)}
                        onChange={() => toggle(row.contactId)}
                        aria-label={`Select ${row.email}`}
                      />
                    ) : null}
                  </TableCell>
                  <TableCell className="font-medium">{row.email}</TableCell>
                  <TableCell>
                    <Badge variant={row.state === "failed" || row.state === "uncertain" ? "info" : "default"}>{row.state}</Badge>
                  </TableCell>
                  <TableCell>{row.attempts}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">{row.lastError ?? "—"}</TableCell>
                  <TableCell>{formatDateTime(row.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {total > PAGE ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}>
              Previous
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={offset + PAGE >= total}
              onClick={() => setOffset((o) => o + PAGE)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
