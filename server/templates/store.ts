import type { DatabaseSync } from "node:sqlite";
import { textToHtml, type VariableMap } from "../domain/template.ts";
import type { TemplateSummary, TemplateUpdate } from "../http/contract.ts";
import type { TemplateRow } from "../send/sendState.ts";
import type { LinkCheck } from "./linkCheck.ts";

export interface TemplateRecord {
  id: number;
  name: string;
  version: number;
  subject: string;
  html: string;
  text: string | null;
  variableMap: VariableMap;
  linkCheck: LinkCheck | null;
  lastTestOkVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewTemplate {
  name: string;
  subject: string;
  html?: string;
  text?: string;
}

interface TemplateDbRow {
  id: number;
  name: string;
  version: number;
  subject: string;
  html: string;
  text: string | null;
  variable_map_json: string;
  link_check_json: string | null;
  last_test_ok_version: number | null;
  created_at: string;
  updated_at: string;
}

function parseObject<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function toRecord(row: TemplateDbRow): TemplateRecord {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    subject: row.subject,
    html: row.html,
    text: row.text,
    variableMap: parseObject<VariableMap>(row.variable_map_json, {}),
    linkCheck: parseObject<LinkCheck | null>(row.link_check_json, null),
    lastTestOkVersion: row.last_test_ok_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function canonicalMap(map: VariableMap): string {
  return JSON.stringify(Object.keys(map).sort().map((key) => [key, map[key]]));
}

export function toTemplateRow(t: TemplateRecord): TemplateRow {
  return { version: t.version, subject: t.subject, html: t.html, text: t.text, variable_map_json: JSON.stringify(t.variableMap) };
}

export function createTemplate(db: DatabaseSync, input: NewTemplate): number {
  const html = input.html ?? textToHtml(input.text ?? "");
  const r = db
    .prepare("INSERT INTO templates (name, subject, html, text) VALUES (?, ?, ?, ?)")
    .run(input.name, input.subject, html, input.text ?? null);
  return Number(r.lastInsertRowid);
}

export function getTemplate(db: DatabaseSync, id: number): TemplateRecord | null {
  const row = db.prepare("SELECT * FROM templates WHERE id = ?").get(id) as TemplateDbRow | undefined;
  return row ? toRecord(row) : null;
}

export function listTemplates(db: DatabaseSync): TemplateSummary[] {
  const rows = db.prepare("SELECT id, name, version, updated_at FROM templates ORDER BY id DESC").all() as {
    id: number;
    name: string;
    version: number;
    updated_at: string;
  }[];
  return rows.map((r) => ({ id: r.id, name: r.name, version: r.version, updatedAt: r.updated_at }));
}

export function updateTemplate(db: DatabaseSync, id: number, patch: TemplateUpdate, now: Date = new Date()): TemplateRecord | null {
  const current = getTemplate(db, id);
  if (!current) return null;
  const text = patch.text === undefined ? current.text : patch.text;
  const wasTextOnly = current.text !== null && current.html === textToHtml(current.text);
  const html = patch.html ?? (wasTextOnly && patch.text ? textToHtml(patch.text) : current.html);
  const subject = patch.subject ?? current.subject;
  const variableMap = patch.variableMap ?? current.variableMap;
  const name = patch.name ?? current.name;

  const bodyChanged = html !== current.html || text !== current.text;
  const contentChanged = bodyChanged || subject !== current.subject || canonicalMap(variableMap) !== canonicalMap(current.variableMap);
  if (!contentChanged && name === current.name) return current;
  db.prepare(
    `UPDATE templates SET name = ?, subject = ?, html = ?, text = ?, variable_map_json = ?, version = version + ?,
       link_check_json = CASE WHEN ? THEN NULL ELSE link_check_json END, updated_at = ?
     WHERE id = ?`,
  ).run(name, subject, html, text, JSON.stringify(variableMap), contentChanged ? 1 : 0, bodyChanged ? 1 : 0, now.toISOString(), id);
  return getTemplate(db, id);
}

export function deleteTemplate(db: DatabaseSync, id: number): "deleted" | "in_use" | "not_found" {
  if (db.prepare("SELECT 1 FROM campaigns WHERE template_id = ? LIMIT 1").get(id)) return "in_use";
  return Number(db.prepare("DELETE FROM templates WHERE id = ?").run(id).changes) === 1 ? "deleted" : "not_found";
}

export function saveLinkCheck(db: DatabaseSync, id: number, check: LinkCheck): boolean {
  const r = db.prepare("UPDATE templates SET link_check_json = ? WHERE id = ? AND version = ?").run(JSON.stringify(check), id, check.version);
  return Number(r.changes) === 1;
}

export function markTested(db: DatabaseSync, id: number, version: number): boolean {
  const r = db.prepare("UPDATE templates SET last_test_ok_version = ? WHERE id = ? AND version = ?").run(version, id, version);
  return Number(r.changes) === 1;
}
