import { randomBytes } from "node:crypto";
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
  | { acquired: false; reason: "running" | "starting" | "unresponsive"; pid: number | null; port: number | null };

interface LockContent {
  pid: number;
  port: number | null;
  startedAt: string;
}

const STARTING_GRACE_MS = 60_000;
const INVALID_GRACE_MS = 2_000;
const REBOOT_SLACK_MS = 60_000;
const PROBE_TIMEOUT_MS = 3_000;
const ATTEMPTS = 5;

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function probeArcher(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/session", headers: { host: `127.0.0.1:${port}` }, timeout: PROBE_TIMEOUT_MS },
      (res) => {
        res.resume();
        const cookies = res.headers["set-cookie"] ?? [];
        resolve(res.statusCode === 204 && cookies.some((c) => c.startsWith("archer_session=")));
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
  probe: probeArcher,
};

interface LockFile {
  raw: string;
  content: LockContent | null;
  mtimeMs: number;
}

function parseLock(raw: string): LockContent | null {
  try {
    const v = JSON.parse(raw) as Partial<LockContent>;
    const valid =
      Number.isInteger(v.pid) &&
      (v.pid as number) > 0 &&
      (v.port === null || Number.isInteger(v.port)) &&
      typeof v.startedAt === "string" &&
      !Number.isNaN(Date.parse(v.startedAt));
    return valid ? (v as LockContent) : null;
  } catch {
    return null;
  }
}

function readLock(lockPath: string): LockFile | null {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    return { raw, content: parseLock(raw), mtimeMs: fs.statSync(lockPath).mtimeMs };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function siblingName(lockPath: string, pid: number, tag: string): string {
  return `${lockPath}.${tag}-${pid}-${randomBytes(6).toString("hex")}`;
}

function writeAtomically(lockPath: string, content: LockContent): void {
  const staging = siblingName(lockPath, content.pid, "tmp");
  fs.writeFileSync(staging, JSON.stringify(content));
  fs.renameSync(staging, lockPath);
}

// link() fails with EEXIST instead of replacing, so the lock appears with its full content or not at all.
function createExclusive(lockPath: string, content: LockContent): boolean {
  const staging = siblingName(lockPath, content.pid, "tmp");
  fs.writeFileSync(staging, JSON.stringify(content));
  try {
    fs.linkSync(staging, lockPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  } finally {
    fs.rmSync(staging, { force: true });
  }
}

// Moves the lock aside and deletes it only if it is still the file judged stale; a lock a rival
// created in the meantime is put back.
function removeIfUnchanged(lockPath: string, judged: LockFile, pid: number): void {
  const aside = siblingName(lockPath, pid, "stale");
  try {
    fs.renameSync(lockPath, aside);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  try {
    if (readLock(aside)?.raw === judged.raw) return;
    try {
      fs.linkSync(aside, lockPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  } finally {
    fs.rmSync(aside, { force: true });
  }
}

function holdsLock(lockPath: string, pid: number): boolean {
  return readLock(lockPath)?.content?.pid === pid;
}

export async function acquireInstanceLock(lockPath: string, overrides: Partial<LockDeps> = {}): Promise<LockResult> {
  const deps = { ...DEFAULT_DEPS, ...overrides };
  const mine: LockContent = { pid: deps.pid, port: null, startedAt: new Date(deps.now()).toISOString() };

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (createExclusive(lockPath, mine)) {
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
    }

    const existing = readLock(lockPath);
    if (!existing) continue;
    const held = existing.content;
    const age = deps.now() - existing.mtimeMs;
    if (!held && age < INVALID_GRACE_MS) return { acquired: false, reason: "starting", pid: null, port: null };
    const stale =
      !held ||
      held.pid === deps.pid ||
      !deps.isAlive(held.pid) ||
      Date.parse(held.startedAt) < deps.bootTime() - REBOOT_SLACK_MS;
    if (held && !stale) {
      if (held.port !== null && (await deps.probe(held.port))) return { acquired: false, reason: "running", pid: held.pid, port: held.port };
      if (age < STARTING_GRACE_MS) return { acquired: false, reason: "starting", pid: held.pid, port: held.port };
      return { acquired: false, reason: "unresponsive", pid: held.pid, port: held.port };
    }
    removeIfUnchanged(lockPath, existing, deps.pid);
  }
  throw new Error(`Could not take the instance lock at ${lockPath}`);
}
