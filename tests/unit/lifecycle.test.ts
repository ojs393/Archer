import { beforeEach, describe, expect, it } from "vitest";
import { installShutdownHandlers, type ShutdownTargets } from "../../server/lifecycle.ts";

type Proc = Pick<NodeJS.Process, "once" | "exit">;

let calls: string[];
let logs: string[];
let listeners: Map<string, (() => void)[]>;
let proc: Proc;

function signal(name: string): void {
  const fns = listeners.get(name) ?? [];
  listeners.set(name, []);
  for (const fn of fns) fn();
}

function targets(overrides: Partial<ShutdownTargets> = {}): ShutdownTargets {
  return {
    watchdog: { stop: () => void calls.push("watchdog.stop") },
    worker: {
      shutdown: async (ms) => {
        calls.push(`worker.shutdown(${ms})`);
      },
    },
    closeServer: async () => {
      calls.push("closeServer");
    },
    db: { close: () => void calls.push("db.close") },
    ...overrides,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  calls = [];
  logs = [];
  listeners = new Map();
  proc = {
    once: (event: string, fn: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
      return proc;
    },
    exit: (code?: number) => {
      calls.push(`exit(${code})`);
    },
  } as unknown as Proc;
});

describe("installShutdownHandlers", () => {
  it("shuts down in order: watchdog, worker, HTTP server, database, then exits 0", async () => {
    const shutdown = installShutdownHandlers(targets(), { proc, log: (m) => logs.push(m) });
    await shutdown();
    expect(calls).toEqual(["watchdog.stop", "worker.shutdown(30000)", "closeServer", "db.close", "exit(0)"]);
  });

  it.each(["SIGINT", "SIGTERM"])("runs on %s", async (sig) => {
    installShutdownHandlers(targets(), { proc, timeoutMs: 1234, log: (m) => logs.push(m) });
    signal(sig);
    await settle();
    expect(calls).toEqual(["watchdog.stop", "worker.shutdown(1234)", "closeServer", "db.close", "exit(0)"]);
  });

  it("is idempotent and keeps swallowing repeated signals while shutting down", async () => {
    let finishWorker: () => void = () => {};
    const shutdown = installShutdownHandlers(
      targets({
        worker: {
          shutdown: () =>
            new Promise<void>((resolve) => {
              calls.push("worker.shutdown");
              finishWorker = resolve;
            }),
        },
      }),
      { proc, log: (m) => logs.push(m) },
    );
    signal("SIGINT");
    await settle();
    expect(listeners.get("SIGINT")).toHaveLength(1);
    signal("SIGINT");
    signal("SIGTERM");
    const again = shutdown();
    expect(listeners.get("SIGINT")).toHaveLength(1);
    expect(listeners.get("SIGTERM")).toHaveLength(1);
    finishWorker();
    await again;
    await settle();
    expect(calls).toEqual(["watchdog.stop", "worker.shutdown", "closeServer", "db.close", "exit(0)"]);
  });

  it("logs a failing step, still runs the rest, and exits 1", async () => {
    const shutdown = installShutdownHandlers(
      targets({
        watchdog: {
          stop: () => {
            throw new Error("timer gone");
          },
        },
        worker: {
          shutdown: async () => {
            calls.push("worker.shutdown");
            throw new Error("db busy");
          },
        },
      }),
      { proc, log: (m) => logs.push(m) },
    );
    await shutdown();
    expect(calls).toEqual(["worker.shutdown", "closeServer", "db.close", "exit(1)"]);
    expect(logs.some((m) => /timer gone/.test(m))).toBe(true);
    expect(logs.some((m) => /db busy/.test(m))).toBe(true);
  });

  it("does not wait forever for an HTTP server that will not close", async () => {
    const shutdown = installShutdownHandlers(
      targets({
        closeServer: () => {
          calls.push("closeServer");
          return new Promise<void>(() => {});
        },
      }),
      { proc, timeoutMs: 20, log: (m) => logs.push(m) },
    );
    await shutdown();
    expect(calls).toEqual(["watchdog.stop", "worker.shutdown(20)", "closeServer", "db.close", "exit(1)"]);
    expect(logs.some((m) => /HTTP server/i.test(m))).toBe(true);
  });

  it("works with only a worker", async () => {
    const shutdown = installShutdownHandlers(
      { worker: { shutdown: async (ms) => void calls.push(`worker.shutdown(${ms})`) } },
      { proc, timeoutMs: 5, log: (m) => logs.push(m) },
    );
    await shutdown();
    expect(calls).toEqual(["worker.shutdown(5)", "exit(0)"]);
  });
});
