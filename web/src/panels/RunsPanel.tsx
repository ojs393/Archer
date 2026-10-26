import { Play, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { isApiError } from "@/lib/api";
import { NEW_RUN_EVENT } from "@/lib/newRunEvent";
import {
  useCampaigns,
  usePauseCampaign,
  useResumeCampaign,
  useStopCampaign,
} from "@/lib/queries/campaigns";
import { useLists } from "@/lib/queries/lists";
import { useTemplates } from "@/lib/queries/templates";
import { NewRunWizard } from "./runs/NewRunWizard";
import { RunDetails } from "./runs/RunDetails";
import { RunsTable } from "./runs/RunsTable";
import { parseRunIdFromHash, setRunIdInHash } from "./runs/runHash";
import { PanelShell } from "./PanelShell";

export default function RunsPanel() {
  const campaigns = useCampaigns();
  const lists = useLists();
  const templates = useTemplates();
  const pause = usePauseCampaign();
  const resume = useResumeCampaign();
  const stop = useStopCampaign();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(() => parseRunIdFromHash());
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    const open = () => setWizardOpen(true);
    window.addEventListener(NEW_RUN_EVENT, open);
    return () => window.removeEventListener(NEW_RUN_EVENT, open);
  }, []);

  useEffect(() => {
    const sync = () => setSelectedId(parseRunIdFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const listNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const l of lists.data ?? []) map.set(l.id, l.name);
    return map;
  }, [lists.data]);

  const templateNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of templates.data ?? []) map.set(t.id, t.name);
    return map;
  }, [templates.data]);

  const rows = campaigns.data ?? [];
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  function select(id: number) {
    setSelectedId(id);
    setRunIdInHash(id);
  }

  async function runAction(id: number, action: "pause" | "resume" | "stop") {
    setBusyId(id);
    try {
      if (action === "pause") await pause.mutateAsync(id);
      else if (action === "resume") await resume.mutateAsync(id);
      else await stop.mutateAsync(id);
      toast.success(action === "pause" ? "Paused" : action === "resume" ? "Resumed" : "Cancelled");
      if (action === "stop") setCancelId(null);
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PanelShell
      title="Runs"
      actions={
        <Button onClick={() => setWizardOpen(true)}>
          <Play aria-hidden="true" />
          New run
        </Button>
      }
    >
      <Card>
        {campaigns.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : campaigns.isError ? (
          <EmptyState icon={Send} title="Could not load runs" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Send}
            title="No runs yet"
            action={{ label: "New run", onClick: () => setWizardOpen(true), icon: Play }}
          />
        ) : (
          <>
            <RunsTable
              rows={rows}
              lists={listNames}
              templates={templateNames}
              selectedId={selectedId}
              busyId={busyId}
              onSelect={select}
              onPause={(id) => void runAction(id, "pause")}
              onResume={(id) => void runAction(id, "resume")}
              onCancel={(id) => setCancelId(id)}
            />
            {selected ? <RunDetails campaign={selected} lists={listNames} templates={templateNames} /> : null}
          </>
        )}
      </Card>

      <NewRunWizard open={wizardOpen} onOpenChange={setWizardOpen} />

      <ConfirmDialog
        open={cancelId !== null}
        onOpenChange={(open) => {
          if (!open) setCancelId(null);
        }}
        title="Cancel this run?"
        description="Sending stops immediately. Remaining recipients stay unsent."
        confirmLabel="Cancel run"
        destructive
        loading={busyId !== null && busyId === cancelId}
        onConfirm={() => {
          if (cancelId !== null) void runAction(cancelId, "stop");
        }}
      />
    </PanelShell>
  );
}
