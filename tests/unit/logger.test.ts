import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, registerSecret } from "../../server/logger.ts";

let dir: string;
let logFile: string;
let lines: string[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mamadirect-log-"));
  logFile = path.join(dir, "logs", "app.log");
  lines = [];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("logger", () => {
  it("writes level and message to the sink and the log file", () => {
    const log = createLogger({ logFile, write: (l) => lines.push(l) });
    log.info("hello", { n: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/INFO hello \{"n":1\}$/);
    expect(fs.readFileSync(logFile, "utf8")).toBe(`${lines[0]}\n`);
  });

  it("redacts registered secrets from strings, objects, and errors", () => {
    registerSecret("s3cr3t-pass");
    const log = createLogger({ logFile, write: (l) => lines.push(l) });
    log.warn("login with s3cr3t-pass");
    log.error({ pass: "s3cr3t-pass" });
    log.error(new Error("auth failed for s3cr3t-pass"));
    const all = lines.join("\n") + fs.readFileSync(logFile, "utf8");
    expect(all).not.toContain("s3cr3t-pass");
    expect(lines[0]).toContain("WARN login with ***");
    expect(lines[1]).toContain('{"pass":"***"}');
    expect(lines[2]).toContain("Error: auth failed for ***");
  });

  it("ignores empty secrets", () => {
    registerSecret("");
    registerSecret(undefined);
    const log = createLogger({ write: (l) => lines.push(l) });
    log.info("plain text");
    expect(lines[0]).toMatch(/INFO plain text$/);
  });
});
