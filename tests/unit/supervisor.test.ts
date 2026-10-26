import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSupervisor, type SupervisorOptions } from "../../server/supervisor.ts";

let dir: string;
let spawnLog: string;
let logs: string[];
let teed: string[];

const COUNT_SPAWN = `import fs from "node:fs"; fs.appendFileSync(process.env.SPAWN_LOG, "spawn\\n");`;

function script(name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${COUNT_SPAWN}\n${body}\n`);
  return file;
}

function spawns(): number {
  return fs.existsSync(spawnLog) ? fs.readFileSync(spawnLog, "utf8").split("\n").filter(Boolean).length : 0;
}

function options(file: string, extra: Partial<SupervisorOptions> = {}): SupervisorOptions {
  return {
    command: process.execPath,
    args: [file],
    backoffMs: [1, 2, 3],
    env: { ...process.env, SPAWN_LOG: spawnLog, MARKER: path.join(dir, "marker") },
    log: (line) => logs.push(line),
    stderr: { write: (chunk: string | Uint8Array) => teed.push(String(chunk)) > 0 },
    ...extra,
  };
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mamadirect-supervisor-"));
  spawnLog = path.join(dir, "spawns.log");
  logs = [];
  teed = [];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("runSupervisor", { timeout: 20_000 }, () => {
  it("gives up after 5 crashes in the window and reports the child's last stderr", async () => {
    const file = script("crash.mjs", `console.error("boom: database is locked"); process.exit(3);`);
    const result = await runSupervisor(options(file)).done;

    expect(result.gaveUp).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(spawns()).toBe(5);
    expect(result.lastStderr).toContain("boom: database is locked");
    expect(teed.join("")).toContain("boom: database is locked");
    const giveUp = logs.at(-1) ?? "";
    expect(giveUp).toMatch(/5 times/);
    expect(giveUp).toContain("boom: database is locked");
  });

  it("keeps only the last 50 stderr lines", async () => {
    const file = script("noisy.mjs", `for (let i = 1; i <= 80; i++) console.error("line " + i); process.exit(1);`);
    const result = await runSupervisor(options(file, { maxCrashes: 1 })).done;

    expect(result.lastStderr).toHaveLength(50);
    expect(result.lastStderr[0]).toBe("line 31");
    expect(result.lastStderr.at(-1)).toBe("line 80");
  });

  it("reports the stderr of the final run only", async () => {
    const file = script(
      "twice.mjs",
      `const n = fs.readFileSync(process.env.SPAWN_LOG, "utf8").split("\\n").filter(Boolean).length;
       console.error("run " + n + " failed");
       process.exit(1);`,
    );
    const result = await runSupervisor(options(file, { maxCrashes: 2 })).done;

    expect(result.lastStderr).toEqual(["run 2 failed"]);
    expect(teed.join("")).toContain("run 1 failed");
  });

  it("does not restart a child that exits 0", async () => {
    const file = script("ok.mjs", `process.exit(0);`);
    const result = await runSupervisor(options(file)).done;

    expect(result).toMatchObject({ exitCode: 0, gaveUp: false });
    expect(spawns()).toBe(1);
  });

  it("restarts after crashes and finishes when the child finally exits 0", async () => {
    const file = script("flaky.mjs", `if (fs.readFileSync(process.env.SPAWN_LOG, "utf8").split("\\n").filter(Boolean).length < 3) process.exit(1); process.exit(0);`);
    const result = await runSupervisor(options(file)).done;

    expect(result).toMatchObject({ exitCode: 0, gaveUp: false });
    expect(spawns()).toBe(3);
    expect(logs.filter((l) => /restarting/i.test(l))).toHaveLength(2);
  });

  it("forgets crashes older than the window", async () => {
    const file = script(
      "slowcrash.mjs",
      `const n = fs.readFileSync(process.env.SPAWN_LOG, "utf8").split("\\n").filter(Boolean).length;
       setTimeout(() => process.exit(n < 4 ? 1 : 0), 40);`,
    );
    const result = await runSupervisor(options(file, { maxCrashes: 2, crashWindowMs: 20 })).done;

    expect(result).toMatchObject({ exitCode: 0, gaveUp: false });
    expect(spawns()).toBe(4);
  });

  it("treats a child that cannot be spawned as a crash", async () => {
    const result = await runSupervisor(
      options("unused", { command: path.join(dir, "no-such-binary"), args: [], maxCrashes: 2 }),
    ).done;

    expect(result.gaveUp).toBe(true);
    expect(result.lastStderr.join("\n")).toMatch(/ENOENT/);
  });

  it.skipIf(process.platform === "win32")("stop() forwards SIGTERM to the child and does not restart it", async () => {
    const file = script(
      "server.mjs",
      `process.on("SIGTERM", () => { fs.writeFileSync(process.env.MARKER, "SIGTERM"); process.exit(0); });
       fs.writeFileSync(process.env.MARKER, "ready");
       setInterval(() => {}, 1000);`,
    );
    const marker = path.join(dir, "marker");
    const handle = runSupervisor(options(file));
    await waitFor(() => fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === "ready", "child ready");
    handle.stop();
    const result = await handle.done;

    expect(fs.readFileSync(marker, "utf8")).toBe("SIGTERM");
    expect(result).toMatchObject({ exitCode: 0, gaveUp: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(spawns()).toBe(1);
  });

  it.skipIf(process.platform === "win32")("a second stop() kills a child that ignores the first signal", async () => {
    const file = script(
      "stubborn.mjs",
      `process.on("SIGTERM", () => {});
       fs.writeFileSync(process.env.MARKER, "ready");
       setInterval(() => {}, 1000);`,
    );
    const marker = path.join(dir, "marker");
    const handle = runSupervisor(options(file));
    await waitFor(() => fs.existsSync(marker), "child ready");
    handle.stop();
    await new Promise((r) => setTimeout(r, 100));
    handle.stop();
    const result = await handle.done;

    expect(result.gaveUp).toBe(false);
    expect(spawns()).toBe(1);
  });

  it("stop() during the restart backoff resolves without spawning again", async () => {
    const file = script("crash.mjs", `process.exit(1);`);
    const handle = runSupervisor(options(file, { backoffMs: [60_000] }));
    await waitFor(() => logs.some((l) => /restarting/i.test(l)), "first crash");
    handle.stop();
    const result = await handle.done;

    expect(result).toMatchObject({ exitCode: 0, gaveUp: false });
    expect(spawns()).toBe(1);
  });
});
