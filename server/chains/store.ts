import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db/transaction.ts";
import type { Schedule } from "../domain/schedule.ts";

export interface ChainStepRecord {
  position: number;
  templateId: number;
  delayHours: number;
}

export interface ChainRecord {
  id: number;
  name: string;
  listId: number;
  schedule: Schedule;
  createdAt: string;
  steps: ChainStepRecord[];
}

export interface ChainSummary {
  id: number;
  name: string;
  listId: number;
  listName: string;
  stepCount: number;
  createdAt: string;
}

function parseSchedule(json: string): Schedule {
  return JSON.parse(json) as Schedule;
}

export function listChains(db: DatabaseSync): ChainSummary[] {
  return (
    db
      .prepare(
        `SELECT ch.id, ch.name, ch.list_id AS listId, l.name AS listName, ch.created_at AS createdAt,
                (SELECT COUNT(*) FROM chain_steps s WHERE s.chain_id = ch.id) AS stepCount
         FROM chains ch JOIN lists l ON l.id = ch.list_id
         ORDER BY ch.id DESC`,
      )
      .all() as unknown as ChainSummary[]
  ).map((r) => ({ ...r }));
}

export function getChain(db: DatabaseSync, id: number): ChainRecord | null {
  const row = db
    .prepare(`SELECT id, name, list_id AS listId, schedule_json AS scheduleJson, created_at AS createdAt FROM chains WHERE id = ?`)
    .get(id) as { id: number; name: string; listId: number; scheduleJson: string; createdAt: string } | undefined;
  if (!row) return null;
  const steps = (
    db
      .prepare(
        `SELECT position, template_id AS templateId, delay_hours AS delayHours FROM chain_steps WHERE chain_id = ? ORDER BY position`,
      )
      .all(id) as unknown as ChainStepRecord[]
  ).map((s) => ({ ...s }));
  return { id: row.id, name: row.name, listId: row.listId, schedule: parseSchedule(row.scheduleJson), createdAt: row.createdAt, steps };
}

export function createChain(
  db: DatabaseSync,
  input: { name: string; listId: number; schedule: Schedule; steps: { templateId: number; delayHours: number }[] },
): number {
  if (input.steps.length < 1) throw new Error("A chain needs at least one step");
  return transaction(db, () => {
    const id = Number(
      db
        .prepare(`INSERT INTO chains (name, list_id, schedule_json) VALUES (?, ?, ?)`)
        .run(input.name.trim(), input.listId, JSON.stringify(input.schedule)).lastInsertRowid,
    );
    const insert = db.prepare(`INSERT INTO chain_steps (chain_id, position, template_id, delay_hours) VALUES (?, ?, ?, ?)`);
    input.steps.forEach((step, position) => {
      insert.run(id, position, step.templateId, step.delayHours);
    });
    return id;
  });
}

export function deleteChain(db: DatabaseSync, id: number): boolean {
  return Number(db.prepare(`DELETE FROM chains WHERE id = ?`).run(id).changes) > 0;
}

export function updateCampaignChainLink(db: DatabaseSync, campaignId: number, chainId: number, step: number): void {
  db.prepare(`UPDATE campaigns SET chain_id = ?, chain_step = ? WHERE id = ?`).run(chainId, step, campaignId);
}

export function nextChainStep(
  db: DatabaseSync,
  chainId: number,
  afterStep: number,
): { templateId: number; delayHours: number; position: number } | null {
  const row = db
    .prepare(
      `SELECT position, template_id AS templateId, delay_hours AS delayHours FROM chain_steps
       WHERE chain_id = ? AND position > ? ORDER BY position LIMIT 1`,
    )
    .get(chainId, afterStep) as { position: number; templateId: number; delayHours: number } | undefined;
  return row ? { ...row } : null;
}

export function campaignChainLink(db: DatabaseSync, campaignId: number): { chainId: number; step: number } | null {
  const row = db
    .prepare(`SELECT chain_id AS chainId, chain_step AS step FROM campaigns WHERE id = ?`)
    .get(campaignId) as { chainId: number | null; step: number | null } | undefined;
  if (!row || row.chainId == null || row.step == null) return null;
  return { chainId: row.chainId, step: row.step };
}
