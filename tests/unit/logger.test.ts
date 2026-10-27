import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, registerSecret } from "../../server/logger.ts";

const ROTATE_AT = 2_000;

let dir: string;
let logFile: string;
let lines: string[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-log-"));
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

  describe("secrets containing characters that serializers escape", () => {
    const secret = `q"u\\o't'e`;
    const forms = [secret, JSON.stringify(secret).slice(1, -1), secret.replace(/'/g, "\\'")];
    const leaked = (text: string) => forms.filter((f) => text.includes(f));

    it("redacts them in strings, objects, and circular objects", () => {
      registerSecret(secret);
      const log = createLogger({ logFile, write: (l) => lines.push(l) });
      const circular: Record<string, unknown> = { pass: secret, nested: [{ token: secret }] };
      circular.self = circular;

      log.info(`pass=${secret}`);
      log.info({ pass: secret, [secret]: "as key" });
      log.info(circular);

      const all = lines.join("\n") + fs.readFileSync(logFile, "utf8");
      expect(leaked(all)).toEqual([]);
      expect(lines[0]).toContain("pass=***");
      expect(lines[1]).toContain('{"pass":"***","***":"as key"}');
      expect(lines[2]).toContain("pass: '***'");
      expect(lines[2]).toContain("token: '***'");
      expect(lines[2]).toContain("[Circular");
    });
  });

  it("keeps non-plain values like dates readable", () => {
    const log = createLogger({ write: (l) => lines.push(l) });
    log.info({ at: new Date("2026-01-02T03:04:05.000Z") });
    expect(lines[0]).toContain('{"at":"2026-01-02T03:04:05.000Z"}');
  });

  it("ignores empty secrets", () => {
    registerSecret("");
    registerSecret(undefined);
    const log = createLogger({ write: (l) => lines.push(l) });
    log.info("plain text");
    expect(lines[0]).toMatch(/INFO plain text$/);
  });

  it("rotates app.log to app.log.1 at the size threshold and starts a shorter file", () => {
    const log = createLogger({ logFile, write: () => {}, rotateBytes: ROTATE_AT });
    const chunk = "x".repeat(400);
    while (!fs.existsSync(logFile) || fs.statSync(logFile).size < ROTATE_AT) {
      log.info(chunk);
    }
    const beforeRotate = fs.statSync(logFile).size;
    expect(beforeRotate).toBeGreaterThanOrEqual(ROTATE_AT);
    log.info("after-threshold");
    const rotated = `${logFile}.1`;
    expect(fs.existsSync(rotated)).toBe(true);
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.statSync(logFile).size).toBeLessThan(beforeRotate);
    expect(fs.readdirSync(path.dirname(logFile)).filter((n) => n.startsWith("app.log")).sort()).toEqual([
      "app.log",
      "app.log.1",
    ]);
    // Second rotate overwrites the previous .1; still only one sibling.
    log.info("y".repeat(ROTATE_AT));
    expect(fs.readdirSync(path.dirname(logFile)).filter((n) => n.startsWith("app.log")).sort()).toEqual([
      "app.log",
      "app.log.1",
    ]);
  });
});
