const numberFormat = new Intl.NumberFormat();
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? numberFormat.format(value) : "-";
}

/** Fraction 0..1 → percent string. Returns "—" when empty (no attempts / no recipients). */
export function formatRate(rate: number | null | undefined, empty: boolean): string {
  if (empty || typeof rate !== "number" || !Number.isFinite(rate)) return "—";
  const pct = rate * 100;
  const digits = pct >= 10 || pct === 0 ? 0 : 1;
  return `${pct.toFixed(digits)}%`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : dateTimeFormat.format(date);
}
