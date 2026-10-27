import { describe, expect, it } from "vitest";
import { run } from "../../../scripts/lib/run.mjs";

const node = process.execPath;
const quiet = { stdio: "ignore" } as const;

describe("run", () => {
  it("resolves ok on exit code 0", async () => {
    const r = await run(node, ["-e", "process.exit(0)"], { ...quiet, timeoutMs: 10_000 });
    expect(r).toEqual({ ok: true, code: 0, timedOut: false, attempts: 1 });
  });

  it("reports a non-zero exit code", async () => {
    const r = await run(node, ["-e", "process.exit(3)"], { ...quiet, timeoutMs: 10_000 });
    expect(r).toEqual({ ok: false, code: 3, timedOut: false, attempts: 1 });
  });

  it("kills a child that exceeds the timeout", async () => {
    const started = Date.now();
    const r = await run(node, ["-e", "setInterval(() => {}, 1000)"], { ...quiet, timeoutMs: 300 });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("retries a failing command and counts attempts", async () => {
    const r = await run(node, ["-e", "process.exit(1)"], { ...quiet, timeoutMs: 10_000, retries: 2 });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(3);
  });

  it("stops retrying after the first success", async () => {
    const r = await run(node, ["-e", "process.exit(0)"], { ...quiet, timeoutMs: 10_000, retries: 2 });
    expect(r.attempts).toBe(1);
  });

  it("captures stdout when stdio is piped", async () => {
    const r = await run(node, ["-e", "process.stdout.write('x'.repeat(200000)); process.exitCode = 1"], {
      stdio: "pipe",
      timeoutMs: 10_000,
    });
    expect(r.code).toBe(1);
    expect(r.stdout).toHaveLength(200_000);
  });

  it("reports a command that cannot be spawned", async () => {
    const r = await run("archer-no-such-binary", [], { ...quiet, timeoutMs: 10_000 });
    expect(r.ok).toBe(false);
    expect(r.code).toBeNull();
    expect(r.error).toMatch(/ENOENT/);
  });
});
