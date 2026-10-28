import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db/transaction.ts";
import { listTagsForList, resolveTagId, setListTags } from "../tags/store.ts";

export interface ListRow {
  id: number;
  name: string;
  source_label: string;
  consent_text: string;
  consent_at: string;
  exclude_roles: number;
  email_column: string | null;
  status: "importing" | "ready" | "failed";
  total_rows: number;
  valid_count: number;
  invalid_count: number;
  duplicate_count: number;
  suppressed_count: number;
  role_count: number;
  error: string | null;
  created_at: string;
}

export type ListView = ListRow & { tags: string[] };

export type ListSort = "id" | "name" | "created_at" | "valid_count";
export type SortOrder = "asc" | "desc";

export interface ListQuery {
  q?: string;
  status?: ListRow["status"];
  tag?: string;
  sort?: ListSort;
  order?: SortOrder;
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

function withTags(db: DatabaseSync, row: ListRow): ListView {
  return { ...row, tags: listTagsForList(db, row.id) };
}

export function createList(
  db: DatabaseSync,
  input: { name: string; sourceLabel: string; consentText: string; excludeRoles: boolean },
): number {
  const name = required(input.name, "List name");
  const sourceLabel = required(input.sourceLabel, "Source label");
  const consentText = required(input.consentText, "Consent attestation");
  const r = db
    .prepare("INSERT INTO lists (name, source_label, consent_text, consent_at, exclude_roles) VALUES (?, ?, ?, ?, ?)")
    .run(name, sourceLabel, consentText, new Date().toISOString(), input.excludeRoles ? 1 : 0);
  return Number(r.lastInsertRowid);
}

export function getList(db: DatabaseSync, id: number): ListRow | undefined {
  const row = db.prepare("SELECT * FROM lists WHERE id = ?").get(id) as ListRow | undefined;
  return row && { ...row };
}

export function getListView(db: DatabaseSync, id: number): ListView | undefined {
  const row = getList(db, id);
  return row ? withTags(db, row) : undefined;
}

export function listLists(db: DatabaseSync, query: ListQuery = {}): ListView[] {
  const where: string[] = [];
  const params: unknown[] = [];
  const q = query.q?.trim();
  if (q) {
    where.push("(name LIKE ? ESCAPE '\\' OR source_label LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/([%_\\])/g, "\\$1")}%`;
    params.push(like, like);
  }
  if (query.status) {
    where.push("status = ?");
    params.push(query.status);
  }
  if (query.tag?.trim()) {
    const tagId = resolveTagId(db, query.tag);
    if (tagId === null) return [];
    where.push("id IN (SELECT list_id FROM list_tags WHERE tag_id = ?)");
    params.push(tagId);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sort = query.sort ?? "id";
  const order = query.order === "asc" ? "ASC" : "DESC";
  const sortCol =
    sort === "name" ? "name COLLATE NOCASE" : sort === "created_at" ? "created_at" : sort === "valid_count" ? "valid_count" : "id";
  const rows = db.prepare(`SELECT * FROM lists ${whereSql} ORDER BY ${sortCol} ${order}`).all(...(params as never[])) as unknown as ListRow[];
  return rows.map((r) => withTags(db, { ...r }));
}

export function updateList(
  db: DatabaseSync,
  id: number,
  patch: { name?: string; source_label?: string; tags?: string[] },
): ListView {
  const row = getList(db, id);
  if (!row) throw new Error("List not found");
  return transaction(db, () => {
    if (patch.name !== undefined) {
      db.prepare("UPDATE lists SET name = ? WHERE id = ?").run(required(patch.name, "List name"), id);
    }
    if (patch.source_label !== undefined) {
      db.prepare("UPDATE lists SET source_label = ? WHERE id = ?").run(required(patch.source_label, "Source label"), id);
    }
    if (patch.tags !== undefined) setListTags(db, id, patch.tags);
    const updated = getList(db, id);
    if (!updated) throw new Error("List not found");
    return withTags(db, updated);
  });
}

export function getListColumns(db: DatabaseSync, listId: number): string[] {
  const row = db.prepare("SELECT fields_json FROM contacts WHERE list_id = ? ORDER BY id LIMIT 1").get(listId) as
    | { fields_json: string }
    | undefined;
  return row ? Object.keys(JSON.parse(row.fields_json) as Record<string, unknown>) : [];
}

export function failInterruptedImports(db: DatabaseSync): number {
  const r = db
    .prepare("UPDATE lists SET status = 'failed', error = ? WHERE status = 'importing'")
    .run("The import was interrupted by a restart; upload the file again");
  return Number(r.changes);
}

export function deleteList(db: DatabaseSync, id: number): void {
  transaction(db, () => {
    if (db.prepare("SELECT 1 FROM campaigns WHERE list_id = ? LIMIT 1").get(id)) {
      throw new Error("This list is used by a campaign; delete the campaign first");
    }
    db.prepare("DELETE FROM lists WHERE id = ?").run(id);
  });
}
