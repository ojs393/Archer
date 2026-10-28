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
import { useUpdateCampaign } from "@/lib/queries/campaigns";
import { useLists } from "@/lib/queries/lists";
import { useTags } from "@/lib/queries/tags";
import { useTemplates } from "@/lib/queries/templates";
import type { CampaignView } from "@/lib/types";

const RECONFIGURE = new Set(["draft", "paused", "safety_stop"]);

export function CampaignConfigureTab({ campaign }: { campaign: CampaignView }) {
  const update = useUpdateCampaign();
  const lists = useLists({});
  const templates = useTemplates();
  const tagsCatalog = useTags();
  const canSwap = RECONFIGURE.has(campaign.status);

  const [title, setTitle] = useState(campaign.title ?? "");
  const [tags, setTags] = useState(campaign.tags ?? []);
  const [listId, setListId] = useState(campaign.listId);
  const [templateId, setTemplateId] = useState(campaign.templateId);
  const [confirmSwap, setConfirmSwap] = useState(false);

  useEffect(() => {
    setTitle(campaign.title ?? "");
    setTags(campaign.tags ?? []);
    setListId(campaign.listId);
    setTemplateId(campaign.templateId);
  }, [campaign.id, campaign.title, campaign.tags, campaign.listId, campaign.templateId]);

  const listChanged = listId !== campaign.listId;
  const templateChanged = templateId !== campaign.templateId;
  const needsConfirm = listChanged || templateChanged;

  async function save(metaOnly = false) {
    try {
      await update.mutateAsync({
        id: campaign.id,
        title,
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

  function onSaveClick() {
    if (needsConfirm && canSwap) setConfirmSwap(true);
    else void save(true);
  }

  return (
    <Card className="flex flex-col gap-4 p-4 animate-in fade-in duration-300">
      {!canSwap ? (
        <p className="text-sm text-muted-foreground">
          List and template are locked while this campaign is {campaign.status}. Pause it to reconfigure.
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="campaign-title">Title</Label>
        <Input id="campaign-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={campaign.displayName} />
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

      {campaign.schedule ? (
        <p className="text-xs text-muted-foreground">
          Schedule: {campaign.schedule.startTime}–{campaign.schedule.endTime} {campaign.schedule.timezone}; cap{" "}
          {campaign.schedule.dailyCap}/day. Change schedule from the run wizard flow while paused via API — rate edits stay on
          the existing schedule endpoint.
        </p>
      ) : null}

      <div>
        <Button type="button" size="sm" loading={update.isPending} onClick={onSaveClick}>
          <Save aria-hidden />
          Save
        </Button>
      </div>

      <ConfirmDialog
        open={confirmSwap}
        onOpenChange={setConfirmSwap}
        title="Reconfigure campaign?"
        description="Sent, failed, and suppressed history is kept. Pending and retry rows are rebuilt from the new list. Template changes apply to future sends only."
        confirmLabel="Apply changes"
        onConfirm={() => void save(false)}
      />
    </Card>
  );
}
