import type { CheckResult } from "./report.mjs";
import type { RunResult } from "./run.mjs";

export type WebBuildState =
  | { state: "no-source" }
  | { state: "missing" }
  | { state: "fresh" }
  | { state: "stale"; newest: string };

/** Compares dist/web/index.html with the newest file under web/ and the build config files. */
export function webBuildState(root: string): WebBuildState;

/** Runs `npm run build:web` when the build is missing or stale. A failure is reported but never fatal. */
export function webBuildCheck(root: string, opts?: { build?: (root: string) => Promise<RunResult> }): Promise<CheckResult>;
