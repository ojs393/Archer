import fs from "node:fs";
import http from "node:http";
import os from "node:os";

export interface LockDeps {
  pid: number;
  now: () => number;
  bootTime: () => number;
  isAlive: (pid: number) => boolean;
  probe: (port: number) => Promise<boolean>;
}

export interface InstanceLock {
  setPort(port: number): void;
  release(): void;
}

export type LockResult =
  | { acquired: true; lock: InstanceLock }
  | { acquired: false; reason: "running" | "starting" | "unresponsive"; pid: number; port: number | null };

interface LockContent {
  pid: number;
  port: number | null;
  startedAt: string;
}

const STARTING_GRACE_MS = 60_000;
const REBOOT_SLACK_MS = 60_000;
const PROBE_TIMEOUT_MS = 3_000;
const ATTEMPTS = 3;

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function probeMamaDirect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/session", headers: { host: `127.0.0.1:${port}` }, timeout: PROBE_TIMEOUT_MS },
      (res) => {
        res.resume();
        const cookies = res.headers["set-cookie"] ?? [];
        resolve(res.statusCode === 204 && cookies.some((c) => c.startsWith("md_session=")));
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

const DEFAULT_DEPS: LockDeps = {
  pid: process.pid,
  now: Date.now,
  bootTime: () => Date.now() - os.uptime() * 1000,
  isAlive: isPidAlive,
  probe: probeMamaDirect,
};

function readLock(lockPath: string): { content: LockContent | null; mtimeMs: number } | null {
  let text: string;
  let mtimeMs: number;
  try {
    text = fs.readFileSync(lockPath, "utf8");
    mtimeMs = fs.statSync(lockPath).mtimeMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    const v = JSON.parse(text) as Partial<LockContent>;
    const valid =
      Number.isInteger(v.pid) &&
      (v.pid as number) > 0 &&
      (v.port === null || Number.isInteger(v.port)) &&
      typeof v.startedAt === "string" &&
      !Number.isNaN(Date.parse(v.startedAt));
    return { content: valid ? (v as LockContent) : null, mtimeMs };
  } catch {
    return { content: null, mtimeMs };
  }
}

function writeAtomically(lockPath: string, content: LockContent): void {
  const staging = `${lockPath}.${content.pid}.tmp`;
  fs.writeFileSync(staging, JSON.stringify(content));
  fs.renameSync(staging, lockPath);
}

function holdsLock(lockPath: string, pid: number): boolean {
  return readLock(lockPath)?.content?.pid === pid;
}

export async function acquireInstanceLock(lockPath: string, overrides: Partial<LockDeps> = {}): Promise<LockResult> {
  const deps = { ...DEFAULT_DEPS, ...overrides };
  const mine: LockContent = { pid: deps.pid, port: null, startedAt: new Date(deps.now()).toISOString() };

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify(mine), { flag: "wx" });
      return {
        acquired: true,
        lock: {
          setPort(port) {
            mine.port = port;
            writeAtomically(lockPath, mine);
          },
          release() {
            try {
              if (holdsLock(lockPath, mine.pid)) fs.rmSync(lockPath, { force: true });
            } catch {
              // Best effort at exit; a leftover lock with a dead pid is taken over on the next start.
            }
          },
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    const existing = readLock(lockPath);
    if (!existing) continue;
    const held = existing.content;
    const stale =
      !held ||
      held.pid === deps.pid ||
      !deps.isAlive(held.pid) ||
      Date.parse(held.startedAt) < deps.bootTime() - REBOOT_SLACK_MS;
    if (!stale) {
      if (held.port !== null && (await deps.probe(held.port))) return { acquired: false, reason: "running", pid: held.pid, port: held.port };
      if (deps.now() - existing.mtimeMs < STARTING_GRACE_MS) return { acquired: false, reason: "starting", pid: held.pid, port: held.port };
      return { acquired: false, reason: "unresponsive", pid: held.pid, port: held.port };
    }
    fs.rmSync(lockPath, { force: true });
  }
  throw new Error(`Could not take the instance lock at ${lockPath}`);
}
