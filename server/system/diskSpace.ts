import fs from "node:fs";

/** Prefer this many free GiB before VACUUM backups or large stress runs. */
export const MIN_FREE_GIB_FOR_BACKUP = 2;
export const MIN_FREE_GIB_FOR_STRESS = 1.5;

export function freeBytes(dir: string): number {
  const s = fs.statfsSync(dir);
  return s.bavail * s.bsize;
}

export function freeGiB(dir: string): number {
  return freeBytes(dir) / 1024 ** 3;
}

/** True when `dir`'s volume has at least `minGiB` free. */
export function hasFreeGiB(dir: string, minGiB: number): boolean {
  try {
    return freeGiB(dir) >= minGiB;
  } catch {
    return true;
  }
}
