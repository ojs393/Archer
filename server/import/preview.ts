import { parse } from "csv-parse/sync";
import { detectEmailColumn, looksLikeEmail, sniffDelimiter, uniqueHeaders } from "./csv.ts";

export const PREVIEW_BYTES = 64 * 1024;
const PREVIEW_ROWS = 5;

export interface CsvPreview {
  delimiter: string;
  headers: string[];
  headerless: boolean;
  rows: string[][];
  emailColumn: number;
}

export class PreviewError extends Error {
  constructor(
    readonly code: "empty_file" | "unparseable",
    message: string,
  ) {
    super(message);
  }
}

function lastLineBreak(text: string): number {
  return Math.max(text.lastIndexOf("\n"), text.lastIndexOf("\r"));
}

export function previewCsv(head: Buffer, truncated: boolean): CsvPreview {
  let text = head.toString("utf8").replace(/^\uFEFF/, "");
  if (truncated) {
    const cut = lastLineBreak(text);
    if (cut > 0) text = text.slice(0, cut);
  }
  const firstLine = text.split(/\r\n|\n|\r/).find((line) => line.trim() !== "") ?? "";
  if (!firstLine) throw new PreviewError("empty_file", "The file is empty");
  const delimiter = sniffDelimiter(firstLine);

  let records: string[][];
  try {
    records = parse(text, {
      delimiter,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
      to: PREVIEW_ROWS + 1,
    }) as string[][];
  } catch (err) {
    const why = err instanceof Error ? err.message.split("\n", 1)[0] : "unknown error";
    throw new PreviewError("unparseable", `Could not read the file as CSV: ${why}`);
  }
  if (records.length === 0) throw new PreviewError("empty_file", "The file is empty");

  const first = records[0];
  const headerless = first.some(looksLikeEmail);
  const headers = headerless ? first.map((_, i) => `column_${i + 1}`) : uniqueHeaders(first);
  const rows = (headerless ? records : records.slice(1)).slice(0, PREVIEW_ROWS);
  return { delimiter, headers, headerless, rows, emailColumn: detectEmailColumn(headers, rows[0] ?? []) };
}
