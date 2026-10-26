import type { DatabaseSync } from "node:sqlite";

export function getSetting(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(
    key,
    value,
  );
}

export function getAllSettings(db: DatabaseSync): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM settings ORDER BY key").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
