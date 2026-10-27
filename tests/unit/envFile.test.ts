import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePaths } from "../../server/config.ts";
import { setEnvValue } from "../../server/settings/envFile.ts";

let dir: string;
let envPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-envfile-"));
  envPath = path.join(dir, ".env");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const read = () => fs.readFileSync(envPath, "utf8");

describe("setEnvValue", () => {
  it("creates the file with mode 0600 and updates the target env", () => {
    const target: Record<string, string | undefined> = {};
    setEnvValue(envPath, "SMTP_PASS", "s3cret", target);
    expect(parseEnv(read()).SMTP_PASS).toBe("s3cret");
    expect(target.SMTP_PASS).toBe("s3cret");
    if (process.platform !== "win32") expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });

  it("replaces an existing key in place and preserves other lines", () => {
    fs.writeFileSync(envPath, "# comment\nUNSUB_SECRET=abc\nSMTP_PASS=old\nexport SMTP_PASS=dupe\nOTHER=1\n");
    setEnvValue(envPath, "SMTP_PASS", "new", {});
    const text = read();
    expect(text.split("\n").slice(0, 2)).toEqual(["# comment", "UNSUB_SECRET=abc"]);
    expect(text).toContain("OTHER=1");
    expect(text.match(/SMTP_PASS/g)).toHaveLength(1);
    expect(parseEnv(text)).toMatchObject({ UNSUB_SECRET: "abc", SMTP_PASS: "new", OTHER: "1" });
  });

  it("removes the key when the value is null", () => {
    fs.writeFileSync(envPath, "A=1\nSMTP_PASS=old\nB=2");
    const target: Record<string, string | undefined> = { SMTP_PASS: "old" };
    setEnvValue(envPath, "SMTP_PASS", null, target);
    expect(read()).not.toContain("SMTP_PASS");
    expect(parseEnv(read())).toEqual({ A: "1", B: "2" });
    expect("SMTP_PASS" in target).toBe(false);
  });

  it.each(["p#ss word", "it's", "a`b'c", 'q"uo\'te`', "back\\slash\\n", "$HOME", "  spaced  "])(
    "round-trips awkward value %j",
    (value) => {
      setEnvValue(envPath, "SMTP_PASS", value, {});
      expect(parseEnv(read()).SMTP_PASS).toBe(value);
    },
  );

  it("refuses values containing line breaks or NUL", () => {
    for (const bad of ["a\nb", "a\rb", "a\u0000b"]) {
      expect(() => setEnvValue(envPath, "SMTP_PASS", bad, {})).toThrow();
    }
    expect(fs.existsSync(envPath)).toBe(false);
  });

  it("refuses a value the .env format cannot represent, leaving the file untouched", () => {
    fs.writeFileSync(envPath, "SMTP_PASS=keep\n");
    expect(() => setEnvValue(envPath, "SMTP_PASS", "'a\"b`c #d'", {})).toThrow(/cannot be stored/);
    expect(read()).toBe("SMTP_PASS=keep\n");
  });

  it("refuses invalid key names", () => {
    expect(() => setEnvValue(envPath, "BAD KEY", "x", {})).toThrow();
  });

  it("leaves no temp files behind", () => {
    setEnvValue(envPath, "SMTP_PASS", "x", {});
    expect(fs.readdirSync(dir)).toEqual([".env"]);
  });
});

describe("resolvePaths env file override", () => {
  it("honors ARCHER_ENV_FILE", () => {
    const root = path.resolve("/proj");
    expect(resolvePaths({ root, env: { ARCHER_ENV_FILE: "/tmp/x.env" } }).envPath).toBe(path.resolve("/tmp/x.env"));
    expect(resolvePaths({ root, env: { ARCHER_ENV_FILE: "conf/.env" } }).envPath).toBe(path.join(root, "conf", ".env"));
    expect(resolvePaths({ root, env: { ARCHER_ENV_FILE: "" } }).envPath).toBe(path.join(root, ".env"));
  });
});
