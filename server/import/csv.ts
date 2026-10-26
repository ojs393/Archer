import { createReadStream, promises as fsp } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream";
import { parse } from "csv-parse";
import { transaction } from "../db/transaction.ts";
import { isSuppressed } from "../db/suppression.ts";
import { emailDomain, isRoleAddress, isValidEmail, normalizeEmail } from "../domain/email.ts";
import { getList } from "./lists.ts";
import type { DomainStatus } from "./mx.ts";
import { pruneInvalidDomains } from "./pruneDomains.ts";

type Delimiter = "," | ";" | "\t";

const DELIMITERS: readonly Delimiter[] = [",", ";", "\t"];
const EMAIL_HEADERS: ReadonlySet<string> = new Set(["email", "e-mail", "email address", "e-mail address", "mail"]);
const SNIFF_BYTES = 64 * 1024;
const MAX_RECORD_SIZE = 1_000_000;
const BATCH_SIZE = 1000;
const MAX_ERROR_LENGTH = 500;
const NO_EMAIL_COLUMN = "No email column found; choose one";

export function sniffDelimiter(firstLine: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "," || ch === ";" || ch === "\t")) counts[ch]++;
  }
  const max = Math.max(...DELIMITERS.map((d) => counts[d]));
  const winners = DELIMITERS.filter((d) => counts[d] === max);
  return max > 0 && winners.length === 1 ? winners[0] : ",";
}

function looksLikeEmail(cell: string): boolean {
  return isValidEmail(normalizeEmail(cell));
}

export function detectEmailColumn(headers: string[], firstRow: string[]): number {
  const byHeader = headers.findIndex((h) => EMAIL_HEADERS.has(h.trim().toLowerCase()));
  return byHeader >= 0 ? byHeader : firstRow.findIndex(looksLikeEmail);
}

export interface ImportCounts {
  totalRows: number;
  valid: number;
  invalid: number;
  duplicate: number;
  suppressed: number;
  role: number;
}

export interface ImportProgress {
  phase: "parsing" | "checking_domains";
  rowsProcessed: number;
  domainsChecked?: number;
  domainsTotal?: number;
}

export interface ImportOptions {
  filePath: string;
  db: DatabaseSync;
  listId: number;
  emailColumn?: string | number;
  excludeRoles: boolean;
  domainChecker?: ((d: string) => Promise<DomainStatus>) | null;
  onProgress?: (p: ImportProgress) => void;
}

async function readFirstLine(filePath: string): Promise<string> {
  const handle = await fsp.open(filePath, "r");
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buf, 0, SNIFF_BYTES, 0);
    const text = buf.subarray(0, bytesRead).toString("utf8").replace(/^\uFEFF/, "");
    return text.split(/\r\n|\n|\r/).find((line) => line.trim() !== "") ?? "";
  } finally {
    await handle.close();
  }
}

function uniqueHeaders(cells: string[]): string[] {
  const seen = new Set<string>();
  return cells.map((cell, i) => {
    const base = cell.trim() || `column_${i + 1}`;
    let name = base;
    for (let n = 2; seen.has(name); n++) name = `${base}_${n}`;
    seen.add(name);
    return name;
  });
}

function resolveEmailColumn(headers: string[], firstRow: string[], override: string | number | undefined): number {
  if (typeof override === "number") {
    if (!Number.isInteger(override) || override < 0 || override >= headers.length) {
      throw new Error(`Email column index ${override} is out of range; the file has ${headers.length} columns`);
    }
    return override;
  }
  if (typeof override === "string") {
    const wanted = override.trim();
    let index = headers.indexOf(wanted);
    if (index < 0) index = headers.findIndex((h) => h.toLowerCase() === wanted.toLowerCase());
    if (index < 0) throw new Error(`Email column "${override}" not found in the file's header`);
    return index;
  }
  const index = detectEmailColumn(headers, firstRow);
  if (index < 0 || index >= headers.length) throw new Error(NO_EMAIL_COLUMN);
  return index;
}

function fieldsJson(record: string[], headers: string[], emailIndex: number): string {
  const fields: Record<string, string> = Object.create(null);
  for (let i = 0; i < headers.length; i++) {
    if (i !== emailIndex) fields[headers[i]] = (record[i] ?? "").trim();
  }
  return JSON.stringify(fields);
}

async function parseAndInsert(opts: ImportOptions, counts: ImportCounts): Promise<string> {
  const { db, listId, excludeRoles, onProgress } = opts;
  const delimiter = sniffDelimiter(await readFirstLine(opts.filePath));
  const parser = parse({
    bom: true,
    delimiter,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    max_record_size: MAX_RECORD_SIZE,
  });
  pipeline(createReadStream(opts.filePath), parser, () => {});

  const insert = db.prepare("INSERT OR IGNORE INTO contacts (list_id, email, domain, fields_json) VALUES (?, ?, ?, ?)");
  let batch: { email: string; fields: string }[] = [];
  let reported = -1;
  const flush = () => {
    const rows = batch;
    batch = [];
    transaction(db, () => {
      for (const { email, fields } of rows) {
        const role = isRoleAddress(email);
        if (isSuppressed(db, email)) counts.suppressed++;
        else if (role && excludeRoles) counts.role++;
        else if (Number(insert.run(listId, email, emailDomain(email), fields).changes) === 0) counts.duplicate++;
        else {
          counts.valid++;
          if (role) counts.role++;
        }
      }
    });
  };
  const report = () => {
    reported = counts.totalRows;
    onProgress?.({ phase: "parsing", rowsProcessed: counts.totalRows });
  };

  let headers: string[] | null = null;
  let emailIndex = -1;
  for await (const record of parser as AsyncIterable<string[]>) {
    if (!headers) {
      if (!record.some(looksLikeEmail)) {
        headers = uniqueHeaders(record);
        continue;
      }
      headers = record.map((_, i) => `column_${i + 1}`);
    }
    if (emailIndex < 0) emailIndex = resolveEmailColumn(headers, record, opts.emailColumn);

    counts.totalRows++;
    const email = normalizeEmail(record[emailIndex] ?? "");
    if (isValidEmail(email)) batch.push({ email, fields: fieldsJson(record, headers, emailIndex) });
    else counts.invalid++;
    if (counts.totalRows % BATCH_SIZE === 0) {
      flush();
      report();
    }
  }

  if (!headers) throw new Error("The file is empty");
  if (emailIndex < 0) emailIndex = resolveEmailColumn(headers, [], opts.emailColumn);
  if (batch.length > 0) flush();
  if (reported !== counts.totalRows) report();
  return headers[emailIndex];
}

async function dropInvalidDomains(
  opts: ImportOptions,
  check: (d: string) => Promise<DomainStatus>,
  counts: ImportCounts,
): Promise<void> {
  const { deleted, rolesDeleted } = await pruneInvalidDomains(opts.db, opts.listId, check, (done, total) =>
    opts.onProgress?.({
      phase: "checking_domains",
      rowsProcessed: counts.totalRows,
      domainsChecked: done,
      domainsTotal: total,
    }),
  );
  counts.valid -= deleted;
  counts.invalid += deleted;
  counts.role -= rolesDeleted;
}

function oneLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_LENGTH) || "Import failed";
}

export async function streamImport(opts: ImportOptions): Promise<ImportCounts & { emailColumn: string }> {
  const { db, listId } = opts;
  if (!getList(db, listId)) throw new Error(`List ${listId} not found`);
  const counts: ImportCounts = { totalRows: 0, valid: 0, invalid: 0, duplicate: 0, suppressed: 0, role: 0 };
  try {
    const emailColumn = await parseAndInsert(opts, counts);
    if (opts.domainChecker) await dropInvalidDomains(opts, opts.domainChecker, counts);
    db.prepare(
      `UPDATE lists SET status = 'ready', error = NULL, email_column = ?, total_rows = ?, valid_count = ?,
        invalid_count = ?, duplicate_count = ?, suppressed_count = ?, role_count = ? WHERE id = ?`,
    ).run(emailColumn, counts.totalRows, counts.valid, counts.invalid, counts.duplicate, counts.suppressed, counts.role, listId);
    return { ...counts, emailColumn };
  } catch (err) {
    try {
      db.prepare("UPDATE lists SET status = 'failed', error = ? WHERE id = ?").run(oneLine(err), listId);
    } catch {
      // The database itself failed; the original error is what the caller needs.
    }
    throw err;
  }
}
