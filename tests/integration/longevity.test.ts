import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recycleUploads } from "../../server/boot/uploads.ts";
import { BACKUPS_KEPT, backup, openDb, pruneBackups } from "../../server/db/index.ts";
import { analyticsSummary } from "../../server/analytics/summary.ts";
import { eventCoverageFrom } from "../../server/analytics/coverage.ts";
import { createList, getList } from "../../server/import/lists.ts";
import { EventHub } from "../../server/http/events.ts";
import { ImportJobs } from "../../server/http/importJobs.ts";
import { createLogger } from "../../server/logger.ts";
import { EventLog } from "../../server/send/events.ts";
import { SendWorker, type SenderConfig, type WorkerDeps } from "../../server/send/worker.ts";
import type { Schedule } from "../../server/domain/schedule.ts";
import { startFakeSmtp, type FakeSmtp } from "../fakeSmtp.ts";

const SECRET = "longevity-unsub-secret-0123456789abcdef";
const START = Date.parse("2026-10-26T10:00:00Z");
const MB = 1024 * 1024;

describe("longevity invariants", () => {
  describe("ring soak", () => {
    let dir: string;
    let db: DatabaseSync;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-longevity-ring-"));
      db = openDb(path.join(dir, "app.db"));
    });

    afterEach(() => {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    // Production KEEP_EVENTS trim is covered in eventLog unit tests; longevity uses a
    // small injectable keep so insert+trimIfDue stays fast (<30s) while still exercising the path.
    it("keeps ≤ keep after 3× insert+trimIfDue; coverageFrom advances; summary matches sends", () => {
      const keep = 200;
      const trimEvery = 50;
      const listId = Number(
        db
          .prepare("INSERT INTO lists (name, source_label, consent_text, consent_at, status) VALUES ('L','s','ok','2026-10-01','ready')")
          .run().lastInsertRowid,
      );
      const contactId = Number(
        db.prepare("INSERT INTO contacts (list_id, email, domain) VALUES (?, 'a@x.com', 'x.com')").run(listId).lastInsertRowid,
      );
      const templateId = Number(
        db.prepare("INSERT INTO templates (name, subject, html) VALUES ('T', 'S', '<p>x</p>')").run().lastInsertRowid,
      );
      const campaignId = Number(
        db
          .prepare("INSERT INTO campaigns (list_id, template_id, template_version, status, schedule_json) VALUES (?, ?, 1, 'completed', '{}')")
          .run(listId, templateId).lastInsertRowid,
      );
      db.prepare("INSERT INTO sends (campaign_id, contact_id, state, attempts) VALUES (?, ?, 'sent', 1)").run(campaignId, contactId);

      const log = new EventLog(db, { keep, trimEvery });
      const total = keep * 3;
      const firstAt = "2026-01-01T00:00:00.000Z";
      for (let i = 0; i < total; i++) {
        const at = i === 0 ? firstAt : new Date(Date.UTC(2026, 5, 1) + i * 1000).toISOString();
        log.insert({
          type: i % 10 === 0 ? "sent" : "status",
          campaignId,
          message: `e${i}`,
          at,
        });
        log.trimIfDue();
      }
      log.trimNow();

      const count = (db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
      expect(count).toBeLessThanOrEqual(keep);
      expect(count).toBe(keep);

      const coverage = eventCoverageFrom(db, null);
      expect(coverage).not.toBeNull();
      expect(coverage! > firstAt).toBe(true);

      const summary = analyticsSummary(db, campaignId);
      expect(summary.totals.sent).toBe(1);
      expect(summary.totals.recipients).toBe(1);
    });
  });

  describe("backup prune", () => {
    it("keeps exactly BACKUPS_KEPT when given more fake daily backups", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-longevity-bak-"));
      try {
        for (let day = 1; day <= 10; day++) {
          const name = `archer-2026-10-${String(day).padStart(2, "0")}.db`;
          fs.writeFileSync(path.join(dir, name), "fake");
        }
        pruneBackups(dir);
        const left = fs.readdirSync(dir).filter((n) => n.endsWith(".db")).sort();
        expect(left).toHaveLength(BACKUPS_KEPT);
        expect(left[0]).toBe("archer-2026-10-04.db");
        expect(left.at(-1)).toBe("archer-2026-10-10.db");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("runs wal recycle after a real backup without throwing", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-longevity-bak2-"));
      const db = openDb(path.join(dir, "app.db"));
      try {
        expect(() => backup(db, path.join(dir, "backups"), new Date("2026-10-26T12:00:00Z"))).not.toThrow();
      } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("log rotate", () => {
    it("leaves only app.log + app.log.1 after crossing the threshold", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-longevity-log-"));
      const logFile = path.join(dir, "app.log");
      try {
        const rotateBytes = 2_000;
        const log = createLogger({ logFile, write: () => {}, rotateBytes });
        const chunk = "pad".repeat(40);
        while (!fs.existsSync(logFile) || fs.statSync(logFile).size < rotateBytes) log.info(chunk);
        const before = fs.statSync(logFile).size;
        log.info("after-threshold");
        expect(fs.readdirSync(dir).sort()).toEqual(["app.log", "app.log.1"]);
        expect(fs.statSync(logFile).size).toBeLessThan(before);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("worker burst", () => {
    let dir: string;
    let db: DatabaseSync;
    let smtp: FakeSmtp;
    let nowMs: number;
    let workers: SendWorker[];
    let savedEnv: string | undefined;

    beforeAll(() => {
      savedEnv = process.env.ARCHER_TEST_SMTP;
      process.env.ARCHER_TEST_SMTP = "1";
    });

    afterAll(() => {
      if (savedEnv === undefined) delete process.env.ARCHER_TEST_SMTP;
      else process.env.ARCHER_TEST_SMTP = savedEnv;
    });

    beforeEach(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-longevity-burst-"));
      db = openDb(path.join(dir, "app.db"));
      smtp = await startFakeSmtp();
      nowMs = START;
      workers = [];
    });

    afterEach(async () => {
      for (const w of workers) await w.shutdown(500);
      await smtp.close();
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it(
      "sends 500 recipients to terminal states with soft heap bound",
      async () => {
        const ALL_DAY: Schedule = {
          timezone: "UTC",
          sendDays: [0, 1, 2, 3, 4, 5, 6],
          startTime: "00:00",
          endTime: "23:59",
          dailyCap: 2000,
          warmup: false,
          delaySeconds: 1,
        };
        const n = 500;
        // Small injectable ring so burst can assert trim (≤ KEEP_EVENTS after 500 is vacuous).
        const keep = 100;
        const trimEvery = 50;
        const listId = Number(
          db
            .prepare("INSERT INTO lists (name, source_label, consent_text, consent_at, status) VALUES ('L','s','ok','2026-10-01','ready')")
            .run().lastInsertRowid,
        );
        const insertContact = db.prepare("INSERT INTO contacts (list_id, email, domain, fields_json) VALUES (?, ?, ?, '{}')");
        const contactIds: number[] = [];
        for (let i = 0; i < n; i++) {
          contactIds.push(
            Number(insertContact.run(listId, `u${i}@example.org`, "example.org").lastInsertRowid),
          );
        }
        const templateId = Number(
          db
            .prepare("INSERT INTO templates (name, version, subject, html, text, variable_map_json) VALUES ('T', 1, 'Hi', '<p>Hi</p>', NULL, '{}')")
            .run().lastInsertRowid,
        );
        const campaignId = Number(
          db
            .prepare("INSERT INTO campaigns (list_id, template_id, template_version, status, schedule_json) VALUES (?, ?, 1, 'draft', ?)")
            .run(listId, templateId, JSON.stringify(ALL_DAY)).lastInsertRowid,
        );
        const insertSend = db.prepare("INSERT INTO sends (campaign_id, contact_id) VALUES (?, ?)");
        for (const id of contactIds) insertSend.run(campaignId, id);

        const sender = (): SenderConfig => ({
          smtp: {
            host: "127.0.0.1",
            port: smtp.port,
            secure: false,
            user: "test",
            pass: "test",
            connectionTimeoutMs: 2000,
            greetingTimeoutMs: 2000,
            socketTimeoutMs: 5000,
          },
          fromName: "Mama Direct",
          fromEmail: "hello@mama.example",
          replyTo: null,
          postalAddress: "PO Box 1",
          unsubMailbox: "unsub@mama.example",
          publicBaseUrl: null,
          unsubSecret: SECRET,
        });
        const advancingSleep = async (ms: number) => {
          nowMs += ms;
          await new Promise<void>((r) => setImmediate(r));
        };
        const stored = db.prepare("SELECT schedule_json FROM campaigns WHERE id = ?").get(campaignId) as { schedule_json: string };
        expect(JSON.parse(stored.schedule_json).delaySeconds).toBe(1);

        const worker = new SendWorker({
          db,
          getSenderConfig: sender,
          now: () => new Date(nowMs),
          sleep: advancingSleep,
          random: () => 0.5,
          probeNetwork: async () => true,
          retryDelaysMs: [1, 1, 1, 1, 1],
          sendTimeoutMs: 3000,
          networkProbeIntervalMs: 10,
          eventLog: { keep, trimEvery },
        } as WorkerDeps);
        workers.push(worker);

        global.gc?.();
        const before = process.memoryUsage().heapUsed;
        worker.start(campaignId);
        const deadline = Date.now() + 60_000;
        while (
          (db.prepare("SELECT status FROM campaigns WHERE id = ?").get(campaignId) as { status: string }).status !== "completed"
        ) {
          if (Date.now() > deadline) throw new Error("campaign did not complete");
          await new Promise((r) => setTimeout(r, 10));
        }

        const states = (
          db.prepare("SELECT state, COUNT(*) AS n FROM sends WHERE campaign_id = ? GROUP BY state").all(campaignId) as {
            state: string;
            n: number;
          }[]
        ).map((r) => [r.state, r.n]);
        expect(states).toEqual([["sent", n]]);

        // Between trims the ring can briefly hold keep + trimEvery − 1 rows.
        const eventCount = (db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
        expect(eventCount).toBeGreaterThan(0);
        expect(eventCount).toBeLessThanOrEqual(keep + trimEvery);
        expect(eventCount).toBeLessThan(n);

        global.gc?.();
        const delta = process.memoryUsage().heapUsed - before;
        if (typeof global.gc === "function") {
          expect(delta).toBeLessThan(50 * MB);
        }
      },
      90_000,
    );
  });

  describe("import temp cleanup", () => {
    it("ImportJobs deletes staged CSV; recycleUploads removes aged incoming orphans", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-longevity-imp-"));
      const db = openDb(path.join(dir, "app.db"));
      const uploads = path.join(dir, "uploads");
      fs.mkdirSync(uploads);
      const events = new EventHub();
      try {
        const staged = path.join(uploads, "1-staged.csv");
        fs.writeFileSync(staged, "email\na@example.com\nb@example.com\n");
        const orphan = path.join(uploads, "incoming-orphan.csv");
        fs.writeFileSync(orphan, "email\nz@example.com\n");
        fs.utimesSync(orphan, new Date(0), new Date(0));

        const listId = createList(db, { name: "imp", sourceLabel: "t", consentText: "ok", excludeRoles: true });
        const imports = new ImportJobs({
          db,
          events,
          createDomainChecker: () => async () => "ok",
          log: { info() {}, warn() {}, error() {} },
        });
        imports.start(listId, staged, { excludeRoles: true, checkDomains: false });
        await imports.idle();

        expect(getList(db, listId)!.valid_count).toBe(2);
        expect(fs.existsSync(staged)).toBe(false);
        expect(fs.readdirSync(uploads).sort()).toEqual(["incoming-orphan.csv"]);

        expect(recycleUploads(uploads, { now: new Date(), maxAgeMs: 1 })).toBe(1);
        expect(fs.readdirSync(uploads)).toEqual([]);
      } finally {
        events.closeAll();
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
