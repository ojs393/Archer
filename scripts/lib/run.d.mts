import type { StdioOptions } from "node:child_process";

export interface RunOptions {
  timeoutMs: number;
  retries?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
  stdio?: StdioOptions;
}

export interface RunResult {
  ok: boolean;
  code: number | null;
  timedOut: boolean;
  attempts: number;
  error?: string;
  /** Present only when stdio is "pipe". */
  stdout?: string;
}

export function run(command: string, args: string[], opts: RunOptions): Promise<RunResult>;
export function runNpm(args: string[], opts: Omit<RunOptions, "shell">): Promise<RunResult>;
