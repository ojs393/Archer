export type CheckStatus = "PASS" | "WARN" | "FAIL" | "FIXED" | "SKIP";

export interface CheckResult {
  status: CheckStatus;
  name: string;
  detail?: string;
  hint?: string;
  /** Set on failures that could not be repaired; any fatal result makes doctor/setup exit non-zero. */
  fatal?: boolean;
}

export function formatResult(result: CheckResult): string;
export function report(result: CheckResult): CheckResult;
