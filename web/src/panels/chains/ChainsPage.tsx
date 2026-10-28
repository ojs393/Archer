import { useMemo, useState } from "react";
import { ArrowLeft, GitBranch, Play, Plus, RotateCw, Trash2 } from "lucide-react";
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
import { navigateToTab } from "@/lib/tabs";
import { formatDateTime } from "@/lib/format";
import { buildSchedule, defaultLocalTimezone } from "@/panels/runs/scheduleMode";

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

  async function onCreate() {
    if (!name.trim() || listId === "" || steps.some((s) => !s.templateId)) {
      toast.error("Name, list, and templates are required");
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
    <section className="flex flex-col gap-4" aria-labelledby="chains-title">
      <button
        type="button"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => navigateToTab("runs")}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        All runs
      </button>
      <h1 id="chains-title" className="text-xl font-semibold tracking-tight text-foreground">
        Chains
      </h1>

      <Card className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">
          A chain is an ordered series of templates on one list. When a step finishes, the next campaign is queued
          automatically (immediate if delay is 0h).
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chain-name">Name</Label>
            <Input id="chain-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Welcome series" />
          </div>
          <div className="flex flex-col gap-1.5">
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
        <div className="flex flex-col gap-2">
          <Label>Steps</Label>
          {steps.map((step, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-6 text-xs text-muted-foreground">{i + 1}.</span>
              <Select
                value={step.templateId ? String(step.templateId) : undefined}
                onValueChange={(v) => {
                  const templateId = Number(v);
                  setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, templateId } : s)));
                }}
              >
                <SelectTrigger className="min-w-[12rem] flex-1" aria-label={`Template for step ${i + 1}`}>
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
              <Input
                type="number"
                min={0}
                className="w-24"
                value={step.delayHours}
                onChange={(e) => {
                  const delayHours = Math.max(0, Number(e.target.value) || 0);
                  setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, delayHours } : s)));
                }}
                aria-label={`Delay hours before step ${i + 1}`}
              />
              <span className="text-xs text-muted-foreground">h delay</span>
              {steps.length > 1 ? (
                <Button type="button" variant="icon" size="sm" onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden />
                </Button>
              ) : null}
            </div>
          ))}
          <Button
            type="button"
            variant="subtle"
            size="sm"
            className="self-start"
            onClick={() => setSteps((prev) => [...prev, { templateId: defaultTemplateId, delayHours: 24 }])}
          >
            <Plus aria-hidden />
            Add step
          </Button>
        </div>
        <div>
          <Button type="button" size="sm" loading={create.isPending} onClick={() => void onCreate()}>
            <Plus aria-hidden />
            Create chain
          </Button>
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
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(chains.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.listName}</TableCell>
                  <TableCell>{row.stepCount}</TableCell>
                  <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button type="button" size="sm" variant="secondary" loading={start.isPending} onClick={() => void onStart(row.id)}>
                        <Play aria-hidden />
                        Start
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setDeleteId(row.id)}>
                        <Trash2 aria-hidden />
                        Delete
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
    </section>
  );
}
