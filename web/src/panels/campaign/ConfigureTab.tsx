import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FolderField } from "@/components/FolderField";
import { TagEditor } from "@/components/TagEditor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { isApiError } from "@/lib/api";
import { isFolderTag } from "@/lib/folders";
import { useUpdateCampaign, useUpdateCampaignSchedule } from "@/lib/queries/campaigns";
import { useLists } from "@/lib/queries/lists";
import { useTags } from "@/lib/queries/tags";
import { useTemplates } from "@/lib/queries/templates";
import type { CampaignView, Schedule } from "@/lib/types";
import { ScheduleStep } from "@/panels/runs/ScheduleStep";
import { buildSchedule, detectMode, type ScheduleMode } from "@/panels/runs/scheduleMode";
import { validateSchedule } from "../../../../server/domain/schedule.ts";

const RECONFIGURE = new Set(["draft", "paused", "safety_stop"]);
const TITLE_MAX = 200;

export function CampaignConfigureTab({ campaign }: { campaign: CampaignView }) {
  const update = useUpdateCampaign();
  const updateSchedule = useUpdateCampaignSchedule();
  const lists = useLists({});
  const templates = useTemplates();
  const tagsCatalog = useTags();
  const canSwap = RECONFIGURE.has(campaign.status);

  const [title, setTitle] = useState(campaign.title ?? "");
  const [tags, setTags] = useState(campaign.tags ?? []);
  const [listId, setListId] = useState(campaign.listId);
  const [templateId, setTemplateId] = useState(campaign.templateId);
  const [confirmSwap, setConfirmSwap] = useState(false);
  const [mode, setMode] = useState<ScheduleMode>(() => detectMode(campaign.schedule));
  const [schedule, setSchedule] = useState<Schedule>(campaign.schedule);

  useEffect(() => {
    setTitle(campaign.title ?? "");
    setTags(campaign.tags ?? []);
    setListId(campaign.listId);
    setTemplateId(campaign.templateId);
    setMode(detectMode(campaign.schedule));
    setSchedule(campaign.schedule);
  }, [campaign.id, campaign.title, campaign.tags, campaign.listId, campaign.templateId, campaign.schedule]);

  const listChanged = listId !== campaign.listId;
  const templateChanged = templateId !== campaign.templateId;
  const needsConfirm = listChanged || templateChanged;
  const remaining = Math.max(0, campaign.counts.pending + campaign.counts.retry);
  const saving = update.isPending || updateSchedule.isPending;

  async function saveMeta(metaOnly = false) {
    const trimmed = title.trim();
    if (trimmed.length > TITLE_MAX) {
      toast.error(`Title must be at most ${TITLE_MAX} characters.`);
      return;
    }
    try {
      await update.mutateAsync({
        id: campaign.id,
        title: trimmed || undefined,
        tags,
        ...(metaOnly
          ? {}
          : {
              ...(listChanged ? { listId } : {}),
              ...(templateChanged ? { templateId } : {}),
            }),
      });
      toast.success("Campaign updated");
      setConfirmSwap(false);
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Could not update campaign");
    }
  }

  async function saveSchedule() {
    if (!canSwap) {
      toast.error("Pause the campaign before changing its schedule.");
      return;
    }
    const errors = validateSchedule(schedule);
    if (errors.length) {
      toast.error(errors[0]!);
      return;
    }
    try {
      await updateSchedule.mutateAsync({ id: campaign.id, schedule });
      toast.success("Schedule updated");
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Could not update schedule");
    }
  }

  function onSaveClick() {
    if (needsConfirm && canSwap) setConfirmSwap(true);
    else void saveMeta(true);
  }

  function onModeChange(next: ScheduleMode) {
    setMode(next);
    setSchedule(
      buildSchedule(next, {
        timezone: schedule.timezone,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        dailyCap: schedule.dailyCap,
        delaySeconds: schedule.delaySeconds,
        sendDays: schedule.sendDays,
      }),
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-4 animate-in fade-in duration-300">
      {!canSwap ? (
        <p className="text-sm text-muted-foreground">
          List, template, and schedule are locked while this campaign is {campaign.status}. Pause it to reconfigure.
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="campaign-title">Title</Label>
        <Input
          id="campaign-title"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={campaign.displayName}
        />
      </div>

      <FolderField tags={tags} onChange={setTags} catalog={tagsCatalog.data ?? []} />

      <div className="flex flex-col gap-1.5">
        <Label>Tags</Label>
        <TagEditor
          value={tags.filter((t) => !isFolderTag(t))}
          onChange={(next) => {
            const folder = tags.find(isFolderTag);
            setTags(folder ? [...next, folder] : next);
          }}
          suggestions={(tagsCatalog.data ?? []).map((t) => t.name).filter((n) => !isFolderTag(n))}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-list">Audience list</Label>
          <Select
            value={String(listId)}
            disabled={!canSwap}
            onValueChange={(v) => setListId(Number(v))}
          >
            <SelectTrigger id="campaign-list" aria-label="Audience list">
              <SelectValue placeholder="Select list" />
            </SelectTrigger>
            <SelectContent>
              {(lists.data ?? []).map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-template">Template</Label>
          <Select
            value={String(templateId)}
            disabled={!canSwap}
            onValueChange={(v) => setTemplateId(Number(v))}
          >
            <SelectTrigger id="campaign-template" aria-label="Template">
              <SelectValue placeholder="Select template" />
            </SelectTrigger>
            <SelectContent>
              {(templates.data ?? []).map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Button type="button" size="sm" loading={update.isPending} onClick={onSaveClick}>
          <Save aria-hidden />
          Save details
        </Button>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="mb-3 text-sm font-medium">Schedule</h3>
        {canSwap ? (
          <>
            <ScheduleStep
              mode={mode}
              onModeChange={onModeChange}
              schedule={schedule}
              onScheduleChange={(patch) => setSchedule((s) => ({ ...s, ...patch }))}
              remaining={remaining}
            />
            <div className="mt-3">
              <Button type="button" size="sm" loading={updateSchedule.isPending} onClick={() => void saveSchedule()}>
                <Save aria-hidden />
                Save schedule
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Schedule: {campaign.schedule.startTime}–{campaign.schedule.endTime} {campaign.schedule.timezone}; cap{" "}
            {campaign.schedule.dailyCap}/day.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmSwap}
        onOpenChange={(open) => {
          if (!saving) setConfirmSwap(open);
        }}
        title="Reconfigure campaign?"
        description="Sent, failed, and suppressed history is kept. Pending and retry rows are rebuilt from the new list. Template changes apply to future sends only."
        confirmLabel="Apply changes"
        loading={update.isPending}
        onConfirm={() => void saveMeta(false)}
      />
    </Card>
  );
}
