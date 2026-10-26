import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { projectRoot } from "./config.ts";

export interface SupervisorOptions {
  command?: string;
  args?: string[];
  backoffMs?: number[];
  maxCrashes?: number;
  crashWindowMs?: number;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  stderr?: { write(chunk: string | Uint8Array): boolean };
}

export interface SupervisorResult {
  exitCode: number;
  gaveUp: boolean;
  lastStderr: string[];
}

export interface SupervisorHandle {
  done: Promise<SupervisorResult>;
  stop(signal?: NodeJS.Signals): void;
}

const STDERR_LINES_KEPT = 50;

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `was killed by ${signal}`;
  if (code !== null && code < 0) return "could not be started";
  return `exited with code ${code}`;
}

export function runSupervisor(opts: SupervisorOptions = {}): SupervisorHandle {
  const command = opts.command ?? process.execPath;
  const args = opts.args ?? ["--disable-warning=ExperimentalWarning", "--import", "tsx", path.join(projectRoot(), "server", "index.ts")];
  const backoffMs = opts.backoffMs?.length ? opts.backoffMs : [1000, 2000, 5000, 10000, 30000];
  const maxCrashes = opts.maxCrashes ?? 5;
  const crashWindowMs = opts.crashWindowMs ?? 300_000;
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.error(line));
  const tee = opts.stderr ?? process.stderr;

  const lastStderr: string[] = [];
  let crashes: number[] = [];
  let child: ChildProcess | null = null;
  let restartTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let finished = false;
  let resolveDone: (r: SupervisorResult) => void = () => {};
  const done = new Promise<SupervisorResult>((resolve) => {
    resolveDone = resolve;
  });

  const keep = (line: string) => {
    lastStderr.push(line);
    if (lastStderr.length > STDERR_LINES_KEPT) lastStderr.splice(0, lastStderr.length - STDERR_LINES_KEPT);
  };

  const finish = (exitCode: number, gaveUp: boolean) => {
    if (finished) return;
    finished = true;
    resolveDone({ exitCode, gaveUp, lastStderr: [...lastStderr] });
  };

  const onCrash = (code: number | null, signal: NodeJS.Signals | null) => {
    const now = Date.now();
    crashes = crashes.filter((at) => now - at < crashWindowMs).concat(now);
    if (crashes.length >= maxCrashes) {
      const tail = lastStderr.length ? lastStderr.join("\n") : "(no error output)";
      log(
        `MamaDirect server ${describeExit(code, signal)}. It crashed ${crashes.length} times within ${Math.round(crashWindowMs / 1000)}s, so the supervisor is giving up.\nLast error output:\n${tail}`,
      );
      finish(1, true);
      return;
    }
    const wait = backoffMs[Math.min(crashes.length - 1, backoffMs.length - 1)];
    log(`MamaDirect server ${describeExit(code, signal)}; restarting in ${wait / 1000}s (crash ${crashes.length} of ${maxCrashes} allowed within ${Math.round(crashWindowMs / 1000)}s)`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!stopping) start();
    }, wait);
  };

  const start = () => {
    let partial = "";
    let closed = false;
    lastStderr.length = 0;
    const proc = spawn(command, args, { env, stdio: ["inherit", "inherit", "pipe"] });
    child = proc;
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      try {
        tee.write(chunk);
      } catch {
        // The child's error output is still kept for the give-up report.
      }
      const lines = (partial + chunk).split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) keep(line);
    });
    proc.on("error", (err) => {
      keep(`[supervisor] ${err.message}`);
    });
    proc.on("close", (code, signal) => {
      if (closed) return;
      closed = true;
      if (partial) keep(partial);
      child = null;
      if (stopping) return finish(code !== null && code > 0 ? code : 0, false);
      if (code === 0) return finish(0, false);
      onCrash(code, signal);
    });
  };

  const stop = (signal: NodeJS.Signals = "SIGTERM") => {
    const again = stopping;
    stopping = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (!child) return finish(0, false);
    try {
      child.kill(again ? "SIGKILL" : signal);
    } catch (err) {
      log(`Could not signal the MamaDirect server: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  start();
  return { done, stop };
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isEntryPoint()) {
  const handle = runSupervisor();
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => handle.stop(sig));
  handle.done.then(
    (result) => process.exit(result.exitCode),
    () => process.exit(1),
  );
}
