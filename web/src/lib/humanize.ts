/** Turn machine field keys into plain labels (first_name → First name). */
export function humanizeKey(key: string): string {
  const cleaned = key.trim().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");
  if (!cleaned) return key;
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Prefer a friendly display value; blank → em dash. */
export function plainValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const s = String(value).trim();
  return s.length ? s : "—";
}
