export interface ShutdownTargets {
  worker: { shutdown(timeoutMs: number): Promise<void> };
  watchdog?: { stop(): void };
  closeServer?: () => Promise<void>;
  db?: { close(): void };
}

export interface ShutdownOptions {
  timeoutMs?: number;
  proc?: Pick<NodeJS.Process, "once" | "exit">;
  log?: (m: string) => void;
}

const SIGNALS = ["SIGINT", "SIGTERM"] as const;
const WORKER_GRACE_MS = 5_000;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function within<T>(work: () => T | Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`did not finish within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([Promise.resolve().then(work), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function installShutdownHandlers(targets: ShutdownTargets, opts: ShutdownOptions = {}): () => Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const proc = opts.proc ?? process;
  const log = opts.log ?? ((m: string) => console.error(m));
  let running: Promise<void> | null = null;

  async function run(): Promise<void> {
    let failed = false;
    const step = async (name: string, work: () => unknown, capMs: number) => {
      try {
        await within(work, capMs);
      } catch (err) {
        failed = true;
        try {
          log(`Shutdown: ${name} failed: ${errorText(err)}`);
        } catch {
          // Logging must not stop the remaining shutdown steps.
        }
      }
    };
    const { watchdog, worker, closeServer, db } = targets;
    if (watchdog) await step("stopping the watchdog", () => watchdog.stop(), timeoutMs);
    await step("stopping the send worker", () => worker.shutdown(timeoutMs), timeoutMs + WORKER_GRACE_MS);
    if (closeServer) await step("closing the HTTP server", closeServer, timeoutMs);
    if (db) await step("closing the database", () => db.close(), timeoutMs);
    proc.exit(failed ? 1 : 0);
  }

  const shutdown = (): Promise<void> => (running ??= run());
  for (const sig of SIGNALS) {
    const onSignal = () => {
      proc.once(sig, onSignal);
      void shutdown();
    };
    proc.once(sig, onSignal);
  }
  return shutdown;
}
