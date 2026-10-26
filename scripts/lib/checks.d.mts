import type { CheckResult } from "./report.mjs";
import type { RunResult } from "./run.mjs";

/** Maps an `npm audit --json --audit-level=high` run to a one-line, never-fatal check result. */
export function auditResult(run: RunResult): CheckResult;

export function runChecks(opts?: {
  quick?: boolean;
  forceInstall?: boolean;
}): Promise<{ ok: boolean; results: CheckResult[] }>;
