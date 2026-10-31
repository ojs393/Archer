export const MIN_FREE_GIB_FOR_BACKUP: number;
export const MIN_FREE_GIB_FOR_STRESS: number;
export function freeGiB(dir: string): number;
export function hasFreeGiB(dir: string, minGiB: number): boolean;
