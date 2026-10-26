import type { CheckResult } from "./report.mjs";

export const MIN_NODE_VERSION: string;
export function meetsMinimum(version: string, minimum?: string): boolean;
export function checkNode(version?: string, platform?: NodeJS.Platform): CheckResult;
export function nodeInstallHint(platform?: NodeJS.Platform): string;
