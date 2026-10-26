import { promises as dns } from "node:dns";

const PROBE_TIMEOUT_MS = 5_000;

export type CappedResult<T> = { kind: "ok"; value: T } | { kind: "error"; err: unknown } | { kind: "timeout" } | { kind: "aborted" };

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

export function settlesWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  return Promise.race([p.then(() => true, () => true), timeout]).finally(() => clearTimeout(timer));
}

export async function dnsProbe(host: string): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([dns.lookup(host).then(() => true, () => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function runCapped<T>(task: () => Promise<T>, capMs: number, signal: AbortSignal): Promise<CappedResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: CappedResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(r);
    };
    const onAbort = () => finish({ kind: "aborted" });
    const timer = setTimeout(() => finish({ kind: "timeout" }), capMs);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(task)
      .then(
        (value) => finish({ kind: "ok", value }),
        (err: unknown) => finish({ kind: "error", err }),
      );
  });
}

export async function untilAborted<T>(p: Promise<T>, signal: AbortSignal, onAbort: T): Promise<T> {
  if (signal.aborted) return onAbort;
  let listener = () => {};
  const aborted = new Promise<T>((resolve) => {
    listener = () => resolve(onAbort);
    signal.addEventListener("abort", listener, { once: true });
  });
  try {
    return await Promise.race([p, aborted]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}
