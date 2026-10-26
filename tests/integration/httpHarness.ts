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
import { ImportJobs } from "../../server/http/importJobs.ts";
import { buildServer, type ServerDeps } from "../../server/http/server.ts";
import type { DomainStatus } from "../../server/import/mx.ts";
import { getSenderConfig, getSmtpConfig } from "../../server/settings/store.ts";
import type { MailTransport, SmtpConfig } from "../../server/send/transport.ts";
import { SendWorker, type WorkerDeps } from "../../server/send/worker.ts";
import type { CheckLinksOptions } from "../../server/templates/linkCheck.ts";

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
  imports: ImportJobs;
  published: { name: string; data: any }[];
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
  uploadLimitBytes?: number;
  build?: (deps: ServerDeps) => FastifyInstance;
  workerDeps?: Partial<WorkerDeps>;
  createTransport?: (cfg: SmtpConfig) => MailTransport;
  linkChecker?: CheckLinksOptions;
}

export async function makeHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mamadirect-http-"));
  const paths = resolvePaths({ root: dir, env: {} });
  ensureDataDirs(paths);
  const db = openDb(paths.dbPath);
  const env: Record<string, string | undefined> = { UNSUB_SECRET, ...opts.env };
  const events = new EventHub();
  const published: Harness["published"] = [];
  const publish = events.publish.bind(events);
  events.publish = (name, data) => {
    published.push({ name, data });
    publish(name, data);
  };
  const log = { info() {}, warn() {}, error() {} };
  const worker = new SendWorker({ db, getSenderConfig: () => getSenderConfig(db, env), ...opts.workerDeps });
  const health = new HealthMonitor({
    db,
    worker,
    getSmtpHost: () => getSmtpConfig(db, env).host,
    probeNetwork: opts.probeNetwork ?? (async () => true),
    onChange: (h) => events.publish("health", h),
  });
  const imports = new ImportJobs({
    db,
    events,
    createDomainChecker: opts.createDomainChecker ?? (() => async () => "ok" as const),
    log,
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
    uploadLimitBytes: opts.uploadLimitBytes,
    createTransport: opts.createTransport,
    linkChecker: opts.linkChecker,
    imports,
    log,
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
    imports,
    published,
    async close() {
      events.closeAll();
      await imports.idle();
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

export interface SeedContact {
  email: string;
  fields?: Record<string, string>;
}

export function seedList(
  db: DatabaseSync,
  contacts: SeedContact[],
  status: "ready" | "importing" | "failed" = "ready",
): { listId: number; contactIds: number[] } {
  const listId = Number(
    db
      .prepare("INSERT INTO lists (name, source_label, consent_text, consent_at, status) VALUES ('L', 'src', 'ok', '2026-10-01', ?)")
      .run(status).lastInsertRowid,
  );
  const insert = db.prepare("INSERT INTO contacts (list_id, email, domain, fields_json) VALUES (?, ?, ?, ?)");
  const contactIds = contacts.map((c) =>
    Number(insert.run(listId, c.email, c.email.split("@")[1], JSON.stringify(c.fields ?? {})).lastInsertRowid),
  );
  return { listId, contactIds };
}

export const TEST_INBOXES = ["me@mine.example", "me2@mine.example"];

export async function configureSender(h: Harness, smtpPort: number, overrides: Record<string, unknown> = {}): Promise<void> {
  h.env.SMTP_PASS = "test";
  const res = await h.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: mutating,
    payload: {
      provider: "smtp",
      fromName: "Mama Direct",
      fromEmail: "hello@mama.example",
      postalAddress: "PO Box 1, Springfield",
      unsubMailbox: "unsub@mama.example",
      testInboxes: TEST_INBOXES,
      smtp: { host: "127.0.0.1", port: smtpPort, secure: false, user: "test" },
      ...overrides,
    },
  });
  if (res.statusCode !== 200) throw new Error(`configureSender failed: ${res.body}`);
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
