import { GitBranch, Play, RotateCw, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { FilterToolbar } from "@/components/FilterToolbar";
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
  useStartCampaign,
  useStopCampaign,
  type CampaignFilters,
} from "@/lib/queries/campaigns";
import { useLists } from "@/lib/queries/lists";
import { useTags } from "@/lib/queries/tags";
import { useTemplates } from "@/lib/queries/templates";
import { NewRunWizard } from "./runs/NewRunWizard";
import { RunsTable } from "./runs/RunsTable";
import { navigateToCampaign } from "@/lib/campaignRoute";
import { folderOptions, isFolderTag } from "@/lib/folders";
import { LIVE_REFETCH_MS } from "@/lib/liveSync";
import { navigateToTab } from "@/lib/tabs";
import { PanelShell } from "./PanelShell";

export default function RunsPanel() {
  const [filters, setFilters] = useState<CampaignFilters>({ sort: "id", order: "desc", status: "", tag: "", q: "" });
  const [folder, setFolder] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const effectiveFilters = useMemo(
    () => ({ ...filters, tag: folder || filters.tag || undefined }),
    [filters, folder],
  );
  const campaigns = useCampaigns(effectiveFilters, true, {
    refetchInterval: (q) => {
      const rows = q.state.data ?? [];
      return rows.some((c) => c.status === "running" || c.status === "waiting_window" || c.status === "waiting_network")
        ? LIVE_REFETCH_MS
        : false;
    },
  });
  const lists = useLists();
  const templates = useTemplates();
  const tags = useTags();
  const start = useStartCampaign();
  const pause = usePauseCampaign();
  const resume = useResumeCampaign();
  const stop = useStopCampaign();

  useEffect(() => {
    const open = () => setWizardOpen(true);
    window.addEventListener(NEW_RUN_EVENT, open);
    return () => window.removeEventListener(NEW_RUN_EVENT, open);
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

  const folderOpts = useMemo(() => folderOptions(tags.data ?? []), [tags.data]);
  const tagOptions = useMemo(
    () =>
      (tags.data ?? [])
        .filter((t) => !isFolderTag(t.name))
        .map((t) => ({ value: t.name, label: `${t.name} (${t.campaignCount})` })),
    [tags.data],
  );

  const rows = campaigns.data ?? [];

  function select(id: number) {
    navigateToCampaign(id);
  }

  async function runAction(id: number, action: "start" | "pause" | "resume" | "stop") {
    setBusyId(id);
    try {
      if (action === "start") await start.mutateAsync(id);
      else if (action === "pause") await pause.mutateAsync(id);
      else if (action === "resume") await resume.mutateAsync(id);
      else await stop.mutateAsync(id);
      toast.success(
        action === "start" ? "Started" : action === "pause" ? "Paused" : action === "resume" ? "Resumed" : "Cancelled",
      );
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
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => {
            navigateToTab("chains");
          }}>
            <GitBranch aria-hidden="true" />
            Chains
          </Button>
          <Button onClick={() => setWizardOpen(true)}>
            <Play aria-hidden="true" />
            New run
          </Button>
        </div>
      }
    >
      <Card>
        <FilterToolbar
          q={filters.q ?? ""}
          onQ={(q) => setFilters((f) => ({ ...f, q }))}
          status={filters.status ?? ""}
          onStatus={(status) => setFilters((f) => ({ ...f, status }))}
          statusOptions={[
            { value: "draft", label: "Draft" },
            { value: "running", label: "Running" },
            { value: "waiting_window", label: "Waiting (window)" },
            { value: "waiting_network", label: "Waiting (network)" },
            { value: "paused", label: "Paused" },
            { value: "safety_stop", label: "Safety stop" },
            { value: "completed", label: "Completed" },
            { value: "stopped", label: "Stopped" },
          ]}
          folder={folder}
          onFolder={(v) => {
            setFolder(v);
            if (v) setFilters((f) => ({ ...f, tag: "" }));
          }}
          folderOptions={folderOpts}
          tag={filters.tag ?? ""}
          onTag={(tag) => {
            setFolder("");
            setFilters((f) => ({ ...f, tag }));
          }}
          tagOptions={tagOptions}
          sort={filters.sort ?? "id"}
          onSort={(sort) => setFilters((f) => ({ ...f, sort: sort as CampaignFilters["sort"] }))}
          sortOptions={[
            { value: "id", label: "Newest id" },
            { value: "created_at", label: "Created" },
            { value: "status", label: "Status" },
            { value: "title", label: "Title" },
          ]}
          order={filters.order ?? "desc"}
          onOrder={(order) => setFilters((f) => ({ ...f, order }))}
        />
        {campaigns.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : campaigns.isError ? (
          <EmptyState
            icon={Send}
            title="Could not load runs"
            action={{ label: "Retry", icon: RotateCw, onClick: () => void campaigns.refetch() }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Send}
            title={filters.q || filters.status || filters.tag ? "No runs match these filters." : "No runs yet"}
            action={
              filters.q || filters.status || filters.tag
                ? undefined
                : { label: "New run", onClick: () => setWizardOpen(true), icon: Play }
            }
          />
        ) : (
          <RunsTable
            rows={rows}
            lists={listNames}
            templates={templateNames}
            selectedId={null}
            busyId={busyId}
            onSelect={select}
            onStart={(id) => void runAction(id, "start")}
            onPause={(id) => void runAction(id, "pause")}
            onResume={(id) => void runAction(id, "resume")}
            onCancel={(id) => setCancelId(id)}
          />
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
