import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { getFreePort, projectRoot } from "../../server/config.ts";

const ROOT = projectRoot();
const BOOT_TIMEOUT_MS = 90_000;

let dir: string;
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

interface Spawned {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

function start(env: NodeJS.ProcessEnv): Spawned {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", path.join(ROOT, "server", "index.ts")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let out = "";
  child.stdout!.on("data", (c: Buffer) => (out += c.toString()));
  child.stderr!.on("data", (c: Buffer) => (out += c.toString()));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, output: () => out, exited };
}

async function until<T>(fn: () => T | null | undefined, timeoutMs: number, what: string, proc: Spawned): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (proc.child.exitCode !== null) throw new Error(`Exited (${proc.child.exitCode}) before ${what}. Output:\n${proc.output()}`);
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}. Output:\n${proc.output()}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function request(port: number, urlPath: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: urlPath, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error("request timed out")));
  });
}

describe("server boot", () => {
  it(
    "boots, serves the API, refuses a second instance, and shuts down cleanly on SIGTERM",
    async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-boot-"));
      const dataDir = path.join(dir, "data");
      const envFile = path.join(dir, "test.env");
      const port = await getFreePort(30_000 + Math.floor(Math.random() * 20_000));
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ARCHER_DATA_DIR: dataDir,
        ARCHER_ENV_FILE: envFile,
        ARCHER_NO_OPEN: "1",
        PORT: String(port),
      };
      delete env.UNSUB_SECRET;
      delete env.SMTP_PASS;

      const first = start(env);
      const infoPath = path.join(dataDir, "server.json");
      const info = await until(
        () => (fs.existsSync(infoPath) ? (JSON.parse(fs.readFileSync(infoPath, "utf8")) as { pid: number; port: number; url: string }) : null),
        BOOT_TIMEOUT_MS,
        "server.json",
        first,
      );
      expect(info).toEqual({ pid: first.child.pid, port, url: `http://127.0.0.1:${port}` });
      expect(fs.existsSync(path.join(dataDir, "archer.lock"))).toBe(true);
      await until(() => first.output().includes(`Archer running at http://127.0.0.1:${port}`), 10_000, "banner", first);

      const secrets = parseEnv(fs.readFileSync(envFile, "utf8"));
      expect(secrets.UNSUB_SECRET).toMatch(/^[0-9a-f]{64}$/);
      if (process.platform !== "win32") expect(fs.statSync(envFile).mode & 0o777).toBe(0o600);
      expect(fs.existsSync(path.join(dataDir, "archer.db"))).toBe(true);
      expect(fs.readdirSync(path.join(dataDir, "backups")).some((f) => /^archer-\d{4}-\d{2}-\d{2}\.db$/.test(f))).toBe(true);

      const session = await request(port, "/api/session");
      expect(session.status).toBe(204);
      const cookie = String(session.headers["set-cookie"]?.[0] ?? "").split(";")[0];
      expect(cookie).toMatch(/^archer_session=[0-9a-f]{64}$/);
      const health = await request(port, "/api/health", { cookie });
      expect(health.status).toBe(200);
      expect(JSON.parse(health.body)).toHaveProperty("worker");
      const rebind = await request(port, "/api/session", { host: `evil.example:${port}` });
      expect(rebind.status).toBe(403);

      const second = start(env);
      const secondCode = await Promise.race([second.exited, new Promise<"hung">((r) => setTimeout(() => r("hung"), BOOT_TIMEOUT_MS))]);
      expect(secondCode).toBe(0);
      expect(second.output()).toContain(`Archer is already running at http://127.0.0.1:${port}`);
      expect(fs.existsSync(infoPath)).toBe(true);

      first.child.kill("SIGTERM");
      const firstCode = await Promise.race([first.exited, new Promise<"hung">((r) => setTimeout(() => r("hung"), 40_000))]);
      expect(firstCode, first.output()).toBe(0);
      expect(fs.existsSync(infoPath)).toBe(false);
      expect(fs.existsSync(path.join(dataDir, "archer.lock"))).toBe(false);
      expect(first.output()).not.toContain(secrets.UNSUB_SECRET);
    },
    BOOT_TIMEOUT_MS * 3,
  );
});
