import { randomBytes } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { openBrowser } from "./boot/browser.ts";
import { acquireInstanceLock } from "./boot/lock.ts";
import { clearDirectory, removeServerInfo, writeServerInfo } from "./boot/runtimeFile.ts";
import { recycleUploads } from "./boot/uploads.ts";
import { config, ensureDataDirs, ensureSecrets, getFreePort, loadEnv } from "./config.ts";
import { backup, openDbWithRecovery } from "./db/index.ts";
import { HealthMonitor } from "./health/monitor.ts";
import { EventHub } from "./http/events.ts";
import { buildPublicServer } from "./http/publicServer.ts";
import { buildServer } from "./http/server.ts";
import { wireWorkerEvents } from "./http/status.ts";
import { failInterruptedImports } from "./import/lists.ts";
import { installShutdownHandlers } from "./lifecycle.ts";
import { logger, registerSecret } from "./logger.ts";
import { Watchdog } from "./send/watchdog.ts";
import { DEFAULT_SEND_TIMEOUT_MS, SendWorker } from "./send/worker.ts";
import { getSenderConfig, getSmtpConfig } from "./settings/store.ts";

const HOST = "127.0.0.1";
const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
const LISTEN_ATTEMPTS = 5;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function runBackup(db: DatabaseSync): void {
  try {
    logger.info(`Backup written to ${backup(db, config.backupsDir)}`);
  } catch (err) {
    logger.error("Backup failed (sending continues; free disk space if this repeats):", err);
  }
}

async function listenMain(build: (port: number) => FastifyInstance): Promise<{ app: FastifyInstance; port: number }> {
  let preferred = config.port;
  for (let attempt = 1; ; attempt++) {
    const port = await getFreePort(preferred);
    const app = build(port);
    try {
      await app.listen({ host: HOST, port });
      return { app, port };
    } catch (err) {
      await app.close().catch(() => {});
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" || attempt >= LISTEN_ATTEMPTS) throw err;
      preferred = port + 1;
    }
  }
}

async function listenPublic(db: DatabaseSync): Promise<FastifyInstance | null> {
  const raw = process.env.ARCHER_PUBLIC_PORT;
  if (!raw) return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    logger.error(`ARCHER_PUBLIC_PORT=${raw} is not a valid port; the public unsubscribe listener is off`);
    return null;
  }
  const app = buildPublicServer({ db, env: process.env });
  try {
    await app.listen({ host: HOST, port });
    logger.info(`Public listener on http://${HOST}:${port} (/u/:token, POST /sns)`);
    return app;
  } catch (err) {
    logger.error(`Could not start the public unsubscribe listener on port ${port}; continuing without it:`, err);
    await app.close().catch(() => {});
    return null;
  }
}

async function main(): Promise<number | null> {
  ensureDataDirs(config);
  const lockPath = path.join(config.dataDir, "archer.lock");
  const infoPath = path.join(config.dataDir, "server.json");
  const held = await acquireInstanceLock(lockPath);
  if (!held.acquired) {
    const where = held.port ? `http://${HOST}:${held.port}` : "(still starting)";
    if (held.reason === "unresponsive") {
      console.error(
        `Another Archer process (pid ${held.pid}) holds ${lockPath} but is not answering at ${where}. ` +
          "Stop that process, or delete the lock file if it is not Archer, then start again.",
      );
      return 1;
    }
    const starting = held.pid === null ? "Archer is already starting" : `Archer is already starting (pid ${held.pid})`;
    console.log(held.reason === "running" ? `Archer is already running at ${where}` : starting);
    return 0;
  }
  const { lock } = held;
  process.once("exit", () => {
    removeServerInfo(infoPath, process.pid);
    lock.release();
  });

  const generated = ensureSecrets(config.envPath);
  loadEnv(config.envPath);
  if (generated.length > 0) logger.info(`Generated ${generated.join(", ")} in ${config.envPath}`);
  registerSecret(process.env.UNSUB_SECRET);
  registerSecret(process.env.SMTP_PASS);

  const { db, restoredFrom, quarantined } = openDbWithRecovery(config.dbPath, config.backupsDir);
  if (restoredFrom) logger.warn(`DATABASE WAS CORRUPT: restored from backup ${restoredFrom}. Changes since that backup are lost.`);
  if (quarantined) logger.warn(`DATABASE WAS CORRUPT and no backup existed: moved it aside to ${quarantined} and started empty.`);
  const interrupted = failInterruptedImports(db);
  if (interrupted > 0) logger.warn(`${interrupted} list import(s) were interrupted by a restart; upload those files again`);
  const cleared = clearDirectory(config.uploadsDir);
  if (cleared > 0) logger.info(`Removed ${cleared} leftover upload file(s)`);
  runBackup(db);
  setInterval(() => {
    runBackup(db);
    const recycled = recycleUploads(config.uploadsDir);
    if (recycled > 0) logger.info(`Recycled ${recycled} stale upload file(s)`);
  }, BACKUP_EVERY_MS).unref();

  const events = new EventHub();
  const progress = { note: () => {} };
  const worker = new SendWorker({
    db,
    getSenderConfig: () => getSenderConfig(db, process.env),
    sendTimeoutMs: DEFAULT_SEND_TIMEOUT_MS,
    onProgress: () => progress.note(),
  });
  const health = new HealthMonitor({
    db,
    worker,
    getSmtpHost: () => getSmtpConfig(db, process.env).host,
    sendTimeoutMs: DEFAULT_SEND_TIMEOUT_MS,
    onChange: (h) => events.publish("health", h),
  });
  wireWorkerEvents({ db, worker, events, health });

  const recovered = worker.recoverOnBoot();
  if (recovered.uncertain > 0) {
    logger.warn(`${recovered.uncertain} send(s) were interrupted mid-send and are marked uncertain (not resent automatically)`);
  }
  if (recovered.resumeCampaignId !== null) {
    try {
      worker.start(recovered.resumeCampaignId);
      logger.info(`Resumed campaign ${recovered.resumeCampaignId} after restart`);
    } catch (err) {
      logger.error(`Could not resume campaign ${recovered.resumeCampaignId}: ${errorText(err)}`);
    }
  }

  const watchdog = new Watchdog(worker, { sendTimeoutMs: DEFAULT_SEND_TIMEOUT_MS, onLog: (m) => logger.warn(m) });
  progress.note = () => watchdog.noteProgress();
  watchdog.start();

  const sessionToken = randomBytes(32).toString("hex");
  registerSecret(sessionToken);
  const { app, port } = await listenMain((p) =>
    buildServer({ db, worker, port: p, sessionToken, paths: config, health, events, env: process.env }),
  );
  lock.setPort(port);
  const publicApp = await listenPublic(db);

  const shutdown = installShutdownHandlers(
    {
      worker,
      watchdog,
      db,
      closeServer: async () => {
        events.closeAll();
        await app.close();
        await publicApp?.close();
      },
    },
    { log: (m) => logger.error(m) },
  );
  process.once("SIGHUP", () => void shutdown());

  const url = `http://${HOST}:${port}`;
  writeServerInfo(infoPath, { pid: process.pid, port, url });
  logger.info(`Archer running at ${url}`);
  if (process.env.ARCHER_NO_OPEN !== "1") openBrowser(url);
  return null;
}

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception; exiting so the supervisor can restart Archer:", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  logger.error("Unhandled promise rejection; exiting so the supervisor can restart Archer:", err);
  process.exit(1);
});

main().then(
  (code) => {
    if (code !== null) process.exit(code);
  },
  (err: unknown) => {
    logger.error("Archer failed to start:", err);
    process.exit(1);
  },
);
