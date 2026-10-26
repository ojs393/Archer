import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireInstanceLock, type LockDeps, type LockResult } from "../../server/boot/lock.ts";

let dir: string;
let lockPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mamadirect-lock-"));
  lockPath = path.join(dir, "mamadirect.lock");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-10-26T12:00:00Z");

function deps(over: Partial<LockDeps> = {}): LockDeps {
  return {
    pid: 1000,
    now: () => NOW,
    bootTime: () => NOW - 3_600_000,
    isAlive: () => false,
    probe: async () => false,
    ...over,
  };
}

function writeLock(content: object | string, ageMs = 0) {
  fs.writeFileSync(lockPath, typeof content === "string" ? content : JSON.stringify(content));
  const at = new Date(NOW - ageMs);
  fs.utimesSync(lockPath, at, at);
}

const read = () => JSON.parse(fs.readFileSync(lockPath, "utf8"));

describe("acquireInstanceLock", () => {
  it("takes a free lock, records the port, and releases only its own lock", async () => {
    const r = await acquireInstanceLock(lockPath, deps());
    expect(r.acquired).toBe(true);
    if (!r.acquired) return;
    expect(read()).toMatchObject({ pid: 1000, port: null });
    r.lock.setPort(5199);
    expect(read()).toMatchObject({ pid: 1000, port: 5199 });
    r.lock.release();
    expect(fs.existsSync(lockPath)).toBe(false);

    writeLock({ pid: 2000, port: 1, startedAt: new Date(NOW).toISOString() });
    r.lock.release();
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("reports an instance that is alive and answering", async () => {
    writeLock({ pid: 2000, port: 5200, startedAt: new Date(NOW - 60_000).toISOString() }, 60_000);
    const r = await acquireInstanceLock(lockPath, deps({ isAlive: (pid) => pid === 2000, probe: async (port) => port === 5200 }));
    expect(r).toEqual({ acquired: false, reason: "running", pid: 2000, port: 5200 });
  });

  it("reports an instance that is still starting up", async () => {
    writeLock({ pid: 2000, port: null, startedAt: new Date(NOW - 5_000).toISOString() }, 5_000);
    const r = await acquireInstanceLock(lockPath, deps({ isAlive: () => true }));
    expect(r).toMatchObject({ acquired: false, reason: "starting", pid: 2000 });
  });

  it("takes over a lock whose process is dead", async () => {
    writeLock({ pid: 2000, port: 5200, startedAt: new Date(NOW - 60_000).toISOString() });
    const r = await acquireInstanceLock(lockPath, deps({ isAlive: () => false }));
    expect(r.acquired).toBe(true);
    expect(read().pid).toBe(1000);
  });

  it("takes over a lock written before the last reboot even if the pid was reused", async () => {
    writeLock({ pid: 2000, port: 5200, startedAt: new Date(NOW - 7_200_000).toISOString() }, 7_200_000);
    const r = await acquireInstanceLock(lockPath, deps({ isAlive: () => true }));
    expect(r.acquired).toBe(true);
  });

  it("takes over a corrupt or empty lock file", async () => {
    for (const junk of ["", "{not json", JSON.stringify({ pid: "x" })]) {
      writeLock(junk, 120_000);
      const r = await acquireInstanceLock(lockPath, deps({ isAlive: () => true }));
      expect(r.acquired, JSON.stringify(junk)).toBe(true);
      fs.rmSync(lockPath);
    }
  });

  it("treats a just-written invalid lock as starting, and only takes it over after a short grace", async () => {
    for (const junk of ["", '{"pid": 20']) {
      writeLock(junk, 500);
      const fresh = await acquireInstanceLock(lockPath, deps());
      expect(fresh, JSON.stringify(junk)).toEqual({ acquired: false, reason: "starting", pid: null, port: null });
      expect(fs.readFileSync(lockPath, "utf8")).toBe(junk);

      writeLock(junk, 3_000);
      const later = await acquireInstanceLock(lockPath, deps());
      expect(later.acquired, JSON.stringify(junk)).toBe(true);
      fs.rmSync(lockPath);
    }
  });

  it("creates the lock with its content in one step and leaves no temp files behind", async () => {
    writeLock({ pid: 2000, port: 5200, startedAt: new Date(NOW - 60_000).toISOString() });
    const r = await acquireInstanceLock(lockPath, deps());
    expect(r.acquired).toBe(true);
    expect(read()).toMatchObject({ pid: 1000, port: null });
    expect(fs.readdirSync(dir)).toEqual(["mamadirect.lock"]);
    if (r.acquired) r.lock.setPort(5300);
    expect(fs.readdirSync(dir)).toEqual(["mamadirect.lock"]);
  });

  it("gives a stale lock to exactly one of two racing acquirers", async () => {
    const realClock = { now: Date.now, bootTime: () => Date.now() - 3_600_000 };
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 2000, port: 5200, startedAt: new Date(Date.now() - 60_000).toISOString() }));
    const race: { rival?: Promise<LockResult> } = {};
    const alive = new Set([1000, 1001]);
    const first = acquireInstanceLock(
      lockPath,
      deps({
        ...realClock,
        pid: 1000,
        isAlive: (pid) => {
          // The rival runs to completion between this process's read of the stale lock and its takeover.
          if (pid === 2000 && !race.rival) {
            race.rival = acquireInstanceLock(lockPath, deps({ ...realClock, pid: 1001, isAlive: (p) => alive.has(p) }));
          }
          return alive.has(pid);
        },
      }),
    );
    expect(race.rival).toBeDefined();
    const results = await Promise.all([first, race.rival!]);
    expect(results.filter((r) => r.acquired)).toHaveLength(1);
    expect(results.find((r) => !r.acquired)).toMatchObject({ reason: "starting" });
    const owner = read().pid;
    expect(results[owner === 1000 ? 0 : 1].acquired).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(["mamadirect.lock"]);
  });

  it("refuses, without taking over, when a live process holds the lock but does not answer", async () => {
    writeLock({ pid: 2000, port: 5200, startedAt: new Date(NOW - 600_000).toISOString() }, 600_000);
    const r = await acquireInstanceLock(lockPath, deps({ isAlive: () => true, probe: async () => false }));
    expect(r).toMatchObject({ acquired: false, reason: "unresponsive", pid: 2000, port: 5200 });
    expect(read().pid).toBe(2000);
  });

  it("treats its own pid in the lock as stale", async () => {
    writeLock({ pid: 1000, port: 5200, startedAt: new Date(NOW - 60_000).toISOString() });
    const r = await acquireInstanceLock(lockPath, deps({ isAlive: () => true, probe: async () => true }));
    expect(r.acquired).toBe(true);
  });
});
