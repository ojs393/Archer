import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db/transaction.ts";

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

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
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

export function listLists(db: DatabaseSync): ListRow[] {
  return (db.prepare("SELECT * FROM lists ORDER BY id DESC").all() as unknown as ListRow[]).map((r) => ({ ...r }));
}

export function getListColumns(db: DatabaseSync, listId: number): string[] {
  const row = db.prepare("SELECT fields_json FROM contacts WHERE list_id = ? ORDER BY id LIMIT 1").get(listId) as
    | { fields_json: string }
    | undefined;
  return row ? Object.keys(JSON.parse(row.fields_json) as Record<string, unknown>) : [];
}

export function deleteList(db: DatabaseSync, id: number): void {
  transaction(db, () => {
    if (db.prepare("SELECT 1 FROM campaigns WHERE list_id = ? LIMIT 1").get(id)) {
      throw new Error("This list is used by a campaign; delete the campaign first");
    }
    db.prepare("DELETE FROM lists WHERE id = ?").run(id);
  });
}
