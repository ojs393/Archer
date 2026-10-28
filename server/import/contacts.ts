import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db/transaction.ts";

export interface ContactRow {
  id: number;
  list_id: number;
  email: string;
  domain: string;
  fields_json: string;
}

export interface ContactView {
  id: number;
  email: string;
  domain: string;
  fields: Record<string, string>;
}

export interface ContactsPage {
  columns: string[];
  total: number;
  contacts: ContactView[];
}

export type ContactSort = "id" | "email" | "domain";
export type SortOrder = "asc" | "desc";

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

function parseFields(json: string): Record<string, string> {
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
      else if (v != null) out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}

export function listContacts(
  db: DatabaseSync,
  listId: number,
  query: { q?: string; sort?: ContactSort; order?: SortOrder; limit?: number; offset?: number } = {},
): ContactsPage {
  const sort = query.sort ?? "id";
  const order = query.order === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const q = query.q?.trim() ?? "";

  const where = ["list_id = ?"];
  const params: unknown[] = [listId];
  if (q) {
    where.push("(email LIKE ? ESCAPE '\\' OR domain LIKE ? ESCAPE '\\' OR fields_json LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/([%_\\])/g, "\\$1")}%`;
    params.push(like, like, like);
  }
  const whereSql = where.join(" AND ");
  const sortCol = sort === "email" ? "email" : sort === "domain" ? "domain" : "id";

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM contacts WHERE ${whereSql}`).get(...(params as never[])) as { n: number }
  ).n;
  const rows = db
    .prepare(`SELECT id, email, domain, fields_json FROM contacts WHERE ${whereSql} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`)
    .all(...(params as never[]), limit, offset) as unknown as ContactRow[];

  const columnsRow = db.prepare("SELECT fields_json FROM contacts WHERE list_id = ? ORDER BY id LIMIT 1").get(listId) as
    | { fields_json: string }
    | undefined;
  const columns = columnsRow ? Object.keys(parseFields(columnsRow.fields_json)) : [];

  return {
    columns,
    total,
    contacts: rows.map((r) => ({ id: r.id, email: r.email, domain: r.domain, fields: parseFields(r.fields_json) })),
  };
}

export function getContact(db: DatabaseSync, listId: number, contactId: number): ContactRow | undefined {
  return db.prepare("SELECT id, list_id, email, domain, fields_json FROM contacts WHERE list_id = ? AND id = ?").get(listId, contactId) as
    | ContactRow
    | undefined;
}

export function updateContact(
  db: DatabaseSync,
  listId: number,
  contactId: number,
  patch: { email?: string; fields?: Record<string, string> },
): ContactView {
  const row = getContact(db, listId, contactId);
  if (!row) throw new Error("Contact not found");

  const email = patch.email !== undefined ? patch.email.trim().toLowerCase() : row.email;
  if (!email || !email.includes("@")) throw new Error("Enter a valid email");
  const domain = domainOf(email);
  const fields = patch.fields !== undefined ? patch.fields : parseFields(row.fields_json);
  const fieldsJson = JSON.stringify(fields);

  try {
    db.prepare("UPDATE contacts SET email = ?, domain = ?, fields_json = ? WHERE list_id = ? AND id = ?").run(
      email,
      domain,
      fieldsJson,
      listId,
      contactId,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(msg)) throw Object.assign(new Error("That email is already on this list"), { code: "duplicate_email" });
    throw err;
  }

  return { id: contactId, email, domain, fields };
}

/** Deletes a contact and decrements list valid_count / total_rows when present. */
export function deleteContact(db: DatabaseSync, listId: number, contactId: number): boolean {
  return transaction(db, () => {
    const row = getContact(db, listId, contactId);
    if (!row) return false;
    db.prepare("DELETE FROM contacts WHERE list_id = ? AND id = ?").run(listId, contactId);
    db.prepare(
      `UPDATE lists SET
         valid_count = MAX(0, valid_count - 1),
         total_rows = MAX(0, total_rows - 1)
       WHERE id = ?`,
    ).run(listId);
    return true;
  });
}
