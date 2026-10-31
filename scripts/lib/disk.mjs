import fs from "node:fs";

/** Match server/system/diskSpace.ts — keep doctor and Node in sync. */
export const MIN_FREE_GIB_FOR_BACKUP = 2;
export const MIN_FREE_GIB_FOR_STRESS = 1.5;

export function freeGiB(dir) {
  const s = fs.statfsSync(dir);
  return (s.bavail * s.bsize) / 1024 ** 3;
}

export function hasFreeGiB(dir, minGiB) {
  try {
    return freeGiB(dir) >= minGiB;
  } catch {
    return true;
  }
}
