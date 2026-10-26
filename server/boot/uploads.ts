import fs from "node:fs";
import path from "node:path";

/** Uploads older than this (and orphan temps of this age) are removed by recycleUploads. */
export const UPLOAD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Delete upload files older than maxAgeMs (including orphan temps `incoming-*` / `*.partial`).
 * In-flight files younger than the TTL are kept. Safe on a missing directory.
 * Returns how many entries were removed.
 */
export function recycleUploads(dir: string, opts: { maxAgeMs?: number; now?: Date } = {}): number {
  const maxAgeMs = opts.maxAgeMs ?? UPLOAD_MAX_AGE_MS;
  const nowMs = (opts.now ?? new Date()).getTime();
  let removed = 0;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      if (nowMs - fs.statSync(full).mtimeMs < maxAgeMs) continue;
      fs.rmSync(full, { recursive: true, force: true });
      removed += 1;
    } catch {
      // Held open or raced; next pass retries.
    }
  }
  return removed;
}
