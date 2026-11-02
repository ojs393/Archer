import { useMemo, useState } from "react";
import { GitBranch, Play, Plus, RotateCw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isApiError } from "@/lib/api";
import { navigateToCampaign } from "@/lib/campaignRoute";
import { useCreateChain, useDeleteChain, useStartChain, useChains } from "@/lib/queries/chains";
import { useLists } from "@/lib/queries/lists";
import { useTemplates } from "@/lib/queries/templates";
import { formatDateTime } from "@/lib/format";
import { buildSchedule, defaultLocalTimezone } from "@/panels/runs/scheduleMode";
import { PanelShell } from "../PanelShell";

type StepDraft = { templateId: number; delayHours: number };

export default function ChainsPage() {
  const chains = useChains();
  const lists = useLists({ status: "ready" });
  const templates = useTemplates();
  const create = useCreateChain();
  const start = useStartChain();
  const del = useDeleteChain();

  const [name, setName] = useState("");
  const [listId, setListId] = useState<number | "">("");
  const [steps, setSteps] = useState<StepDraft[]>([{ templateId: 0, delayHours: 0 }]);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const templateOptions = templates.data ?? [];
  const listOptions = lists.data ?? [];
  const defaultTemplateId = templateOptions[0]?.id ?? 0;

  const schedule = useMemo(
    () =>
      buildSchedule("window", {
        timezone: defaultLocalTimezone(),
        startTime: "09:00",
        endTime: "17:00",
        dailyCap: 2000,
        delaySeconds: 2,
      }),
    [],
  );

  const MAX_DELAY_HOURS = 24 * 90;

  async function onCreate() {
    if (!name.trim() || listId === "" || steps.some((s) => !s.templateId)) {
      toast.error("Name, list, and templates are required");
      return;
    }
    if (steps.some((s) => !Number.isInteger(s.delayHours) || s.delayHours < 0 || s.delayHours > MAX_DELAY_HOURS)) {
      toast.error(`Delay hours must be a whole number from 0 to ${MAX_DELAY_HOURS}.`);
      return;
    }
    try {
      await create.mutateAsync({
        name: name.trim(),
        listId: Number(listId),
        schedule,
        steps: steps.map((s) => ({ templateId: s.templateId, delayHours: s.delayHours })),
      });
      toast.success("Chain created");
      setName("");
      setSteps([{ templateId: defaultTemplateId, delayHours: 0 }]);
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Could not create chain");
    }
  }

  async function onStart(id: number) {
    try {
      const campaign = await start.mutateAsync({ id, autoStart: true });
      toast.success("Chain started");
      navigateToCampaign(campaign.id);
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Could not start chain");
    }
  }

  return (
    <PanelShell
      title="Chains"
      info="Ordered templates on one list. When a step finishes, the next campaign is queued automatically."
    >
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Build a multi-step series. Delay hours run before each step after the first (0 = immediate).
        </p>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="chain-name">Name</Label>
            <Input id="chain-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Welcome series" />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="chain-list">Audience</Label>
            <Select
              value={listId === "" ? undefined : String(listId)}
              onValueChange={(v) => setListId(Number(v))}
            >
              <SelectTrigger id="chain-list" aria-label="Audience">
                <SelectValue placeholder="Select list…" />
              </SelectTrigger>
              <SelectContent>
                {listOptions.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <Label>Steps</Label>
          {steps.map((step, i) => (
            <div key={i} className="flex min-w-0 flex-col gap-2 rounded-md border border-border/80 bg-zinc-50/60 p-2.5 sm:flex-row sm:flex-wrap sm:items-center">
              <span className="w-6 shrink-0 text-xs font-medium text-muted-foreground">{i + 1}.</span>
              <Select
                value={step.templateId ? String(step.templateId) : undefined}
                onValueChange={(v) => {
                  const templateId = Number(v);
                  setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, templateId } : s)));
                }}
              >
                <SelectTrigger className="min-w-0 flex-1 sm:min-w-[12rem]" aria-label={`Template for step ${i + 1}`}>
                  <SelectValue placeholder="Template…" />
                </SelectTrigger>
                <SelectContent>
                  {templateOptions.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  className="w-20 shrink-0"
                  value={step.delayHours}
                  max={MAX_DELAY_HOURS}
                  onChange={(e) => {
                    const delayHours = Math.min(MAX_DELAY_HOURS, Math.max(0, Math.floor(Number(e.target.value) || 0)));
                    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, delayHours } : s)));
                  }}
                  aria-label={`Delay hours before step ${i + 1}`}
                />
                <span className="shrink-0 text-xs text-muted-foreground">h delay</span>
                {steps.length > 1 ? (
                  <Button type="button" variant="icon" size="sm" onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="subtle"
              size="sm"
              onClick={() => setSteps((prev) => [...prev, { templateId: defaultTemplateId, delayHours: 24 }])}
            >
              <Plus aria-hidden />
              Add step
            </Button>
            <Button type="button" size="sm" loading={create.isPending} onClick={() => void onCreate()}>
              <Plus aria-hidden />
              Create chain
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        {chains.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : chains.isError ? (
          <EmptyState
            icon={GitBranch}
            title="Could not load chains"
            action={{ label: "Retry", icon: RotateCw, onClick: () => void chains.refetch() }}
          />
        ) : (chains.data ?? []).length === 0 ? (
          <EmptyState icon={GitBranch} title="No chains yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>List</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead className="hidden sm:table-cell">Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(chains.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-[10rem] font-medium sm:max-w-[16rem]">
                    <span className="block truncate">{row.name}</span>
                  </TableCell>
                  <TableCell className="max-w-[8rem] sm:max-w-[12rem]">
                    <span className="block truncate">{row.listName}</span>
                  </TableCell>
                  <TableCell>{row.stepCount}</TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatDateTime(row.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button type="button" size="sm" variant="secondary" loading={start.isPending} onClick={() => void onStart(row.id)}>
                        <Play aria-hidden />
                        Start
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setDeleteId(row.id)}>
                        <Trash2 aria-hidden />
                        <span className="max-sm:hidden">Delete</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title="Delete this chain?"
        description="Existing campaigns from this chain stay. Only the recipe is removed."
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onConfirm={async () => {
          if (deleteId === null) return;
          try {
            await del.mutateAsync(deleteId);
            toast.success("Chain deleted");
            setDeleteId(null);
          } catch (err) {
            toast.error(isApiError(err) ? err.message : "Could not delete");
          }
        }}
      />
    </PanelShell>
  );
}
