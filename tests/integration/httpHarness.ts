import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { ensureDataDirs, resolvePaths, type AppPaths } from "../../server/config.ts";
import { openDb } from "../../server/db/index.ts";
import type { AuthResolver } from "../../server/dns/check.ts";
import { HealthMonitor } from "../../server/health/monitor.ts";
import { EventHub } from "../../server/http/events.ts";
import { buildServer, type ServerDeps } from "../../server/http/server.ts";
import type { DomainStatus } from "../../server/import/mx.ts";
import { getSenderConfig, getSettingsView } from "../../server/settings/store.ts";
import type { SmtpConfig } from "../../server/send/transport.ts";
import { SendWorker } from "../../server/send/worker.ts";

export const PORT = 5199;
export const TOKEN = "a".repeat(64);
export const ORIGIN = `http://127.0.0.1:${PORT}`;
export const UNSUB_SECRET = "u".repeat(64);

export const authed = {
  host: `127.0.0.1:${PORT}`,
  cookie: `md_session=${TOKEN}`,
} as const;

export const mutating = { ...authed, origin: ORIGIN, "x-mamadirect": "1" } as const;

export interface Harness {
  app: FastifyInstance;
  db: DatabaseSync;
  dir: string;
  paths: AppPaths;
  env: Record<string, string | undefined>;
  events: EventHub;
  health: HealthMonitor;
  worker: SendWorker;
  close(): Promise<void>;
}

export interface HarnessOptions {
  env?: Record<string, string | undefined>;
  webDir?: string;
  dnsResolver?: AuthResolver;
  verifySmtp?: (cfg: SmtpConfig) => Promise<void>;
  createDomainChecker?: () => (d: string) => Promise<DomainStatus>;
  probeNetwork?: (host: string) => Promise<boolean>;
  registerSecret?: (value: string) => void;
  extend?: (app: FastifyInstance) => void;
  build?: (deps: ServerDeps) => FastifyInstance;
}

export async function makeHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mamadirect-http-"));
  const paths = resolvePaths({ root: dir, env: {} });
  ensureDataDirs(paths);
  const db = openDb(paths.dbPath);
  const env: Record<string, string | undefined> = { UNSUB_SECRET, ...opts.env };
  const events = new EventHub();
  const worker = new SendWorker({ db, getSenderConfig: () => getSenderConfig(db, env) });
  const health = new HealthMonitor({
    db,
    worker,
    getSmtpHost: () => getSettingsView(db, env).smtp.host,
    probeNetwork: opts.probeNetwork ?? (async () => true),
    onChange: (h) => events.publish("health", h),
  });
  const deps: ServerDeps = {
    db,
    worker,
    port: PORT,
    sessionToken: TOKEN,
    paths,
    health,
    events,
    env,
    webDir: opts.webDir ?? path.join(dir, "no-web"),
    dnsResolver: opts.dnsResolver,
    verifySmtp: opts.verifySmtp,
    createDomainChecker: opts.createDomainChecker,
    registerSecret: opts.registerSecret ?? (() => {}),
    log: { info() {}, warn() {}, error() {} },
  };
  const app = (opts.build ?? buildServer)(deps);
  opts.extend?.(app);
  await app.ready();
  return {
    app,
    db,
    dir,
    paths,
    env,
    events,
    health,
    worker,
    async close() {
      events.closeAll();
      await app.close().catch(() => {});
      await worker.shutdown(500);
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function multipart(
  fields: Record<string, string>,
  file?: { name?: string; filename?: string; content: string | Buffer; type?: string },
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----mamadirect${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name ?? "file"}"; filename="${file.filename ?? "list.csv"}"\r\nContent-Type: ${file.type ?? "text/csv"}\r\n\r\n`,
      ),
      Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content),
      Buffer.from("\r\n"),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
