import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  wizardPanelClass,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { isApiError } from "@/lib/api";
import { useHealth, useSettings } from "@/lib/queries";
import { useCreateCampaign, useStartCampaign } from "@/lib/queries/campaigns";
import { useLists } from "@/lib/queries/lists";
import { useTemplates } from "@/lib/queries/templates";
import { cn } from "@/lib/utils";
import type { Gate, Schedule } from "@/lib/types";
import { AudienceStep } from "./AudienceStep";
import { ReviewStep } from "./ReviewStep";
import { ScheduleStep } from "./ScheduleStep";
import { TemplateStep } from "./TemplateStep";
import { buildSchedule, defaultLocalTimezone, type ScheduleMode } from "./scheduleMode";

const TABS = ["audience", "template", "schedule", "review"] as const;
type TabId = (typeof TABS)[number];
const DRAFT_KEY = "archer:run-draft";

type Draft = {
  listId: number | null;
  templateId: number | null;
  mode: ScheduleMode;
  schedule: Schedule;
};

function emptyDraft(): Draft {
  const timezone = defaultLocalTimezone();
  return {
    listId: null,
    templateId: null,
    mode: "window",
    schedule: buildSchedule("window", {
      timezone,
      startTime: "09:00",
      endTime: "17:00",
      dailyCap: 2000,
      delaySeconds: 10,
    }),
  };
}

function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as Partial<Draft>;
    const base = emptyDraft();
    return {
      listId: typeof parsed.listId === "number" ? parsed.listId : null,
      templateId: typeof parsed.templateId === "number" ? parsed.templateId : null,
      mode: parsed.mode === "asap" || parsed.mode === "warmup" || parsed.mode === "window" ? parsed.mode : "window",
      schedule: { ...base.schedule, ...(parsed.schedule ?? {}) },
    };
  } catch {
    return emptyDraft();
  }
}

function saveDraft(draft: Draft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // ignore
  }
}

function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

export function NewRunWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const lists = useLists({}, open);
  const templates = useTemplates(open);
  const settings = useSettings(open);
  const health = useHealth(open);
  const create = useCreateCampaign();
  const start = useStartCampaign();

  const [tab, setTab] = useState<TabId>("audience");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [launchGates, setLaunchGates] = useState<Gate[] | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  /** Reuse this id on retry so a failed start does not create duplicate draft campaigns. */
  const [createdCampaignId, setCreatedCampaignId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      setHydrated(false);
      return;
    }
    setDraft(loadDraft());
    setTab("audience");
    setLaunchGates(null);
    setStartError(null);
    setCreatedCampaignId(null);
    setHydrated(true);
  }, [open]);

  useEffect(() => {
    if (open && hydrated) saveDraft(draft);
  }, [draft, open, hydrated]);

  const list = useMemo(() => lists.data?.find((l) => l.id === draft.listId) ?? null, [lists.data, draft.listId]);
  const template = useMemo(
    () => templates.data?.find((t) => t.id === draft.templateId) ?? null,
    [templates.data, draft.templateId],
  );

  const audienceOk = draft.listId !== null && list?.status === "ready";
  const templateOk = draft.templateId !== null;
  const scheduleOk = draft.schedule.startTime < draft.schedule.endTime && draft.schedule.dailyCap >= 1;
  const unlocked: Record<TabId, boolean> = {
    audience: true,
    template: audienceOk,
    schedule: audienceOk && templateOk,
    review: audienceOk && templateOk && scheduleOk,
  };

  function patchDraft(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function setMode(mode: ScheduleMode) {
    setDraft((d) => ({
      ...d,
      mode,
      schedule: buildSchedule(mode, {
        timezone: d.schedule.timezone,
        startTime: d.schedule.startTime,
        endTime: d.schedule.endTime,
        dailyCap: d.schedule.dailyCap,
        delaySeconds: d.schedule.delaySeconds,
        sendDays: d.schedule.sendDays,
      }),
    }));
  }

  function go(delta: -1 | 1) {
    const i = TABS.indexOf(tab);
    const next = TABS[i + delta];
    if (!next) return;
    if (delta > 0 && !unlocked[next]) return;
    setTab(next);
  }

  async function handleStart() {
    if (!draft.listId || !draft.templateId) return;
    setSubmitting(true);
    setStartError(null);
    setLaunchGates(null);
    try {
      let campaignId = createdCampaignId;
      if (campaignId === null) {
        const campaign = await create.mutateAsync({
          listId: draft.listId,
          templateId: draft.templateId,
          schedule: draft.schedule,
        });
        campaignId = campaign.id;
        setCreatedCampaignId(campaignId);
      }
      try {
        await start.mutateAsync(campaignId);
      } catch (err) {
        if (isApiError(err, "gates_failed") && Array.isArray(err.details)) {
          setLaunchGates(err.details as Gate[]);
          setStartError("Launch checks failed. Fix the items below, then try again.");
          setTab("review");
          return;
        }
        throw err;
      }
      clearDraft();
      setDraft(emptyDraft());
      setCreatedCampaignId(null);
      onOpenChange(false);
      toast.success("Run started");
    } catch (err) {
      setStartError(isApiError(err) ? err.message : "Could not start the run");
      setTab("review");
    } finally {
      setSubmitting(false);
    }
  }

  const remaining = list?.valid_count ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-4xl", wizardPanelClass)} aria-describedby="new-run-desc">
        <DialogHeader className="mx-0 mt-0">
          <DialogTitle>New run</DialogTitle>
          <DialogDescription id="new-run-desc">Choose audience, template, and schedule, then start.</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <Tabs
            value={tab}
            onValueChange={(v) => {
              const next = v as TabId;
              if (!unlocked[next]) return;
              setTab(next);
            }}
            className="flex min-h-0 flex-1 flex-col gap-4"
          >
            <TabsList aria-label="New run steps">
              <TabsTrigger value="audience">Audience</TabsTrigger>
              <TabsTrigger value="template" disabled={!unlocked.template}>
                Template
              </TabsTrigger>
              <TabsTrigger value="schedule" disabled={!unlocked.schedule}>
                Schedule
              </TabsTrigger>
              <TabsTrigger value="review" disabled={!unlocked.review}>
                Review
              </TabsTrigger>
            </TabsList>

            <TabsContent value="audience">
              <AudienceStep lists={lists.data ?? []} listId={draft.listId} onListIdChange={(listId) => patchDraft({ listId })} />
            </TabsContent>
            <TabsContent value="template">
              <TemplateStep
                templates={templates.data ?? []}
                templateId={draft.templateId}
                listId={draft.listId}
                onTemplateIdChange={(templateId) => patchDraft({ templateId })}
              />
            </TabsContent>
            <TabsContent value="schedule">
              <ScheduleStep
                mode={draft.mode}
                onModeChange={setMode}
                schedule={draft.schedule}
                onScheduleChange={(patch) => patchDraft({ schedule: { ...draft.schedule, ...patch } })}
                remaining={remaining}
              />
            </TabsContent>
            <TabsContent value="review">
              <ReviewStep
                list={list}
                template={template}
                mode={draft.mode}
                schedule={draft.schedule}
                settings={settings.data}
                health={health.data}
                launchGates={launchGates}
                startError={startError}
              />
            </TabsContent>
          </Tabs>
        </DialogBody>

        <DialogFooter className="mx-0 mb-0 sm:justify-between">
          <Button variant="secondary" onClick={() => go(-1)} disabled={tab === "audience" || submitting}>
            <ChevronLeft aria-hidden="true" />
            Back
          </Button>
          <div className="flex gap-2">
            {tab !== "review" ? (
              <Button
                onClick={() => go(1)}
                disabled={
                  submitting ||
                  (tab === "audience" && !audienceOk) ||
                  (tab === "template" && !templateOk) ||
                  (tab === "schedule" && !scheduleOk)
                }
              >
                Next
                <ChevronRight aria-hidden="true" />
              </Button>
            ) : (
              <Button onClick={() => void handleStart()} loading={submitting} disabled={!audienceOk || !templateOk}>
                {submitting ? null : <Play aria-hidden="true" />}
                Start run
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
