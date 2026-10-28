import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db/transaction.ts";

export interface TagRow {
  id: number;
  name: string;
  color: string | null;
}

export interface TagSummary extends TagRow {
  listCount: number;
  campaignCount: number;
}

/** Trim + lowercase; empty after trim throws. */
export function normalizeTagName(raw: string): string {
  const name = raw.trim().toLowerCase();
  if (!name) throw new Error("Tag name is required");
  if (name.length > 64) throw new Error("Tag name is too long");
  return name;
}

export function ensureTag(db: DatabaseSync, rawName: string, color: string | null = null): TagRow {
  const name = normalizeTagName(rawName);
  const existing = db.prepare("SELECT id, name, color FROM tags WHERE name = ? COLLATE NOCASE").get(name) as TagRow | undefined;
  if (existing) return existing;
  const r = db.prepare("INSERT INTO tags (name, color) VALUES (?, ?)").run(name, color);
  return { id: Number(r.lastInsertRowid), name, color };
}

export function listTagsForList(db: DatabaseSync, listId: number): string[] {
  return (
    db
      .prepare(
        `SELECT t.name FROM tags t
         JOIN list_tags lt ON lt.tag_id = t.id
         WHERE lt.list_id = ?
         ORDER BY t.name COLLATE NOCASE`,
      )
      .all(listId) as { name: string }[]
  ).map((r) => r.name);
}

export function listTagsForCampaign(db: DatabaseSync, campaignId: number): string[] {
  return (
    db
      .prepare(
        `SELECT t.name FROM tags t
         JOIN campaign_tags ct ON ct.tag_id = t.id
         WHERE ct.campaign_id = ?
         ORDER BY t.name COLLATE NOCASE`,
      )
      .all(campaignId) as { name: string }[]
  ).map((r) => r.name);
}

/** Replace the full tag set for a list (create-on-write). */
export function setListTags(db: DatabaseSync, listId: number, names: readonly string[]): string[] {
  return transaction(db, () => {
    db.prepare("DELETE FROM list_tags WHERE list_id = ?").run(listId);
    const insert = db.prepare("INSERT OR IGNORE INTO list_tags (list_id, tag_id) VALUES (?, ?)");
    const seen = new Set<string>();
    for (const raw of names) {
      const name = normalizeTagName(raw);
      if (seen.has(name)) continue;
      seen.add(name);
      insert.run(listId, ensureTag(db, name).id);
    }
    return listTagsForList(db, listId);
  });
}

/** Replace the full tag set for a campaign (create-on-write). */
export function setCampaignTags(db: DatabaseSync, campaignId: number, names: readonly string[]): string[] {
  return transaction(db, () => {
    db.prepare("DELETE FROM campaign_tags WHERE campaign_id = ?").run(campaignId);
    const insert = db.prepare("INSERT OR IGNORE INTO campaign_tags (campaign_id, tag_id) VALUES (?, ?)");
    const seen = new Set<string>();
    for (const raw of names) {
      const name = normalizeTagName(raw);
      if (seen.has(name)) continue;
      seen.add(name);
      insert.run(campaignId, ensureTag(db, name).id);
    }
    return listTagsForCampaign(db, campaignId);
  });
}

export function listAllTags(db: DatabaseSync): TagSummary[] {
  return db
    .prepare(
      `SELECT t.id, t.name, t.color,
              (SELECT COUNT(*) FROM list_tags lt WHERE lt.tag_id = t.id) AS listCount,
              (SELECT COUNT(*) FROM campaign_tags ct WHERE ct.tag_id = t.id) AS campaignCount
       FROM tags t
       ORDER BY t.name COLLATE NOCASE`,
    )
    .all() as unknown as TagSummary[];
}

export function resolveTagId(db: DatabaseSync, tag: string): number | null {
  const asId = Number(tag);
  if (Number.isInteger(asId) && asId > 0 && String(asId) === tag.trim()) {
    const row = db.prepare("SELECT id FROM tags WHERE id = ?").get(asId) as { id: number } | undefined;
    return row?.id ?? null;
  }
  try {
    const name = normalizeTagName(tag);
    const row = db.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE").get(name) as { id: number } | undefined;
    return row?.id ?? null;
  } catch {
    return null;
  }
}
