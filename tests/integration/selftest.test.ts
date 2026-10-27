import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const run = promisify(execFile);

describe("self-test script", () => {
  it("sends a mini-campaign to the in-process fake SMTP server, prints PASS and cleans up", async () => {
    const guardDir = path.join(os.tmpdir(), `archer-selftest-guard-${process.pid}-${Date.now()}`);
    const env: NodeJS.ProcessEnv = { ...process.env, ARCHER_DATA_DIR: guardDir };
    delete env.ARCHER_TEST_SMTP;
    const started = Date.now();
    const { stdout } = await run(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", "--import", "tsx", path.join(root, "server", "selftest.ts")],
      { cwd: root, env, timeout: 60_000 },
    );
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(stdout).not.toMatch(/^FAIL/m);
    for (const step of ["import", "campaign completed", "3 sent", "3 received", "personalized", "List-Unsubscribe", "footer"]) {
      expect(stdout).toMatch(new RegExp(`^PASS ${step}`, "m"));
    }
    expect(stdout.trim().split("\n").at(-1)).toMatch(/^PASS self-test/);
    const tempDir = /^Self-test directory: (.+)$/m.exec(stdout)?.[1];
    expect(tempDir).toBeDefined();
    expect(fs.existsSync(tempDir!)).toBe(false);
    expect(fs.existsSync(guardDir)).toBe(false);
  }, 60_000);
});
