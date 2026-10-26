import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDataDirs, ensureSecrets, loadEnv } from "../../../scripts/lib/env.mjs";
import { resolvePaths } from "../../../scripts/lib/paths.mjs";

let dir: string;
let envPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mamadirect-env-"));
  envPath = path.join(dir, ".env");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const parse = (file: string) => loadEnv(file, {});

describe("ensureSecrets", () => {
  it("creates .env with a 64-hex-char UNSUB_SECRET", () => {
    expect(ensureSecrets(envPath)).toEqual(["UNSUB_SECRET"]);
    expect(parse(envPath).UNSUB_SECRET).toMatch(/^[0-9a-f]{64}$/);
  });

  it.skipIf(process.platform === "win32")("creates .env with mode 0600", () => {
    ensureSecrets(envPath);
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });

  it("never overwrites an existing value", () => {
    ensureSecrets(envPath);
    const first = parse(envPath).UNSUB_SECRET;
    expect(ensureSecrets(envPath)).toEqual([]);
    expect(parse(envPath).UNSUB_SECRET).toBe(first);
  });

  it("preserves unrelated keys", () => {
    fs.writeFileSync(envPath, "PORT=6000\nSMTP_PASS=hunter2");
    ensureSecrets(envPath);
    const env = parse(envPath);
    expect(env.PORT).toBe("6000");
    expect(env.SMTP_PASS).toBe("hunter2");
    expect(env.UNSUB_SECRET).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fills a key that is present but empty without duplicating it", () => {
    fs.writeFileSync(envPath, "UNSUB_SECRET=\nPORT=6000\n");
    expect(ensureSecrets(envPath)).toEqual(["UNSUB_SECRET"]);
    const text = fs.readFileSync(envPath, "utf8");
    expect(text.match(/^UNSUB_SECRET=/gm)).toHaveLength(1);
    expect(parse(envPath).UNSUB_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(parse(envPath).PORT).toBe("6000");
  });
});

describe("loadEnv", () => {
  it("returns {} when the file is missing", () => {
    expect(loadEnv(envPath, {})).toEqual({});
  });

  it("copies values into the target env without overriding existing ones", () => {
    fs.writeFileSync(envPath, "A=from-file\nB=from-file\n");
    const target: Record<string, string | undefined> = { A: "already-set" };
    expect(loadEnv(envPath, target)).toEqual({ A: "from-file", B: "from-file" });
    expect(target).toEqual({ A: "already-set", B: "from-file" });
  });
});

describe("ensureDataDirs", () => {
  it("creates the data tree and reports what it created", () => {
    const p = resolvePaths({ root: dir, env: {} });
    expect(ensureDataDirs(p)).toEqual([p.dataDir, p.uploadsDir, p.logsDir, p.backupsDir]);
    for (const d of [p.dataDir, p.uploadsDir, p.logsDir, p.backupsDir]) {
      expect(fs.statSync(d).isDirectory()).toBe(true);
    }
    expect(ensureDataDirs(p)).toEqual([]);
  });
});
