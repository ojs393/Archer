import type { DatabaseSync } from "node:sqlite";
import { createCampaign, recordEvent } from "../campaigns/store.ts";
import { getTemplate } from "../templates/store.ts";
import { campaignChainLink, getChain, nextChainStep, updateCampaignChainLink } from "./store.ts";

/**
 * When a campaign finishes, create the next chain step as a new campaign.
 * delayHours === 0 → ready to start (caller may auto-start); otherwise left as draft.
 */
export async function maybeQueueNextChainStep(
  db: DatabaseSync,
  campaignId: number,
  creating: Set<number> = new Set(),
): Promise<{ nextCampaignId: number; delayHours: number; autoStart: boolean } | null> {
  const link = campaignChainLink(db, campaignId);
  if (!link) return null;
  const chain = getChain(db, link.chainId);
  if (!chain) return null;
  const next = nextChainStep(db, link.chainId, link.step);
  if (!next) {
    recordEvent(db, campaignId, "chain", `Chain "${chain.name}" finished`);
    return null;
  }
  const template = getTemplate(db, next.templateId);
  if (!template) {
    recordEvent(db, campaignId, "chain", `Chain step ${next.position} skipped: template missing`);
    return null;
  }
  const nextId = await createCampaign(
    db,
    { listId: chain.listId, templateId: template.id, templateVersion: template.version, schedule: chain.schedule },
    creating,
  );
  updateCampaignChainLink(db, nextId, chain.id, next.position);
  db.prepare(`UPDATE campaigns SET title = ? WHERE id = ?`).run(`${chain.name} · step ${next.position + 1}`, nextId);
  const autoStart = next.delayHours === 0;
  recordEvent(
    db,
    campaignId,
    "chain",
    autoStart
      ? `Queued chain step ${next.position + 1} as campaign ${nextId}`
      : `Queued chain step ${next.position + 1} as campaign ${nextId} (wait ${next.delayHours}h before starting)`,
  );
  recordEvent(db, nextId, "chain", `Created from chain "${chain.name}" after campaign ${campaignId}`);
  return { nextCampaignId: nextId, delayHours: next.delayHours, autoStart };
}
