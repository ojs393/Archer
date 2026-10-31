import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Schedule } from "../../server/domain/schedule.ts";
import { SendWorker, type SenderConfig, type WorkerDeps } from "../../server/send/worker.ts";
import { startFakeSmtp, type FakeSmtp } from "../fakeSmtp.ts";
import { scaleSendCount, seedPersonalizedList } from "../helpers/generateAudience.ts";
import { makeHarness, type Harness } from "./httpHarness.ts";

/**
 * Personalized send at scale.
 * - Default: 5_000 (CI)
 * - Nightly / heavy: ARCHER_SCALE_SEND=nightly → 50_000
 */
const N = scaleSendCount();
const SECRET = "u".repeat(64);

const ALL_DAY: Schedule = {
  timezone: "UTC",
  sendDays: [0, 1, 2, 3, 4, 5, 6],
  startTime: "00:00",
  endTime: "23:59",
  dailyCap: 100_000,
  warmup: false,
  delaySeconds: 1,
};

let h: Harness;
let smtp: FakeSmtp;
let nowMs: number;
let worker: SendWorker | null = null;

beforeAll(() => {
  process.env.ARCHER_TEST_SMTP = "1";
});

beforeEach(async () => {
  smtp = await startFakeSmtp();
  nowMs = Date.parse("2026-10-26T10:00:00Z");
  h = await makeHarness();
});

afterEach(async () => {
  if (worker) {
    await worker.shutdown(2_000).catch(() => {});
    worker = null;
  }
  await h?.close();
  await smtp.close();
});

afterAll(() => {
  delete process.env.ARCHER_TEST_SMTP;
});

describe(`personalized send scale (N=${N.toLocaleString("en-US")})`, () => {
  it(
    `delivers ${N.toLocaleString("en-US")} mails with To ↔ first_name merge and no stall`,
    async () => {
      const { listId, byEmail } = seedPersonalizedList(h.db, N);
      const templateId = Number(
        h.db
          .prepare(
            `INSERT INTO templates (name, version, subject, html, text, variable_map_json, last_test_ok_version)
             VALUES ('Scale', 1, 'Hello {{first_name}}', '<p>Hi {{first_name}},</p><p>{{postal_address}}</p><p>{{unsubscribe_url}}</p>', NULL, '{}', 1)`,
          )
          .run().lastInsertRowid,
      );
      const campaignId = Number(
        h.db
          .prepare(
            "INSERT INTO campaigns (list_id, template_id, template_version, status, schedule_json) VALUES (?, ?, 1, 'draft', ?)",
          )
          .run(listId, templateId, JSON.stringify(ALL_DAY)).lastInsertRowid,
      );
      const insertSend = h.db.prepare("INSERT INTO sends (campaign_id, contact_id) VALUES (?, ?)");
      const contactIds = h.db
        .prepare("SELECT id FROM contacts WHERE list_id = ? ORDER BY id")
        .all(listId) as { id: number }[];
      for (const row of contactIds) insertSend.run(campaignId, row.id);

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
        fromName: "Archer Scale",
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

      worker = new SendWorker({
        db: h.db,
        getSenderConfig: sender,
        now: () => new Date(nowMs),
        sleep: advancingSleep,
        random: () => 0.5,
        probeNetwork: async () => true,
        retryDelaysMs: [1, 1, 1, 1, 1],
        sendTimeoutMs: 3000,
        networkProbeIntervalMs: 10,
      } as WorkerDeps);

      const started = Date.now();
      worker.start(campaignId);

      // Stall watchdog: must keep finishing or throw.
      let lastSent = 0;
      let lastProgressAt = Date.now();
      const STALL_MS = N >= 50_000 ? 120_000 : 45_000;
      const HARD_MS = N >= 50_000 ? 600_000 : 180_000;

      while (
        (h.db.prepare("SELECT status FROM campaigns WHERE id = ?").get(campaignId) as { status: string }).status !==
        "completed"
      ) {
        if (Date.now() - started > HARD_MS) throw new Error(`campaign did not complete in ${HARD_MS}ms`);
        const sent = (
          h.db.prepare("SELECT COUNT(*) AS n FROM sends WHERE campaign_id = ? AND state = 'sent'").get(campaignId) as {
            n: number;
          }
        ).n;
        if (sent > lastSent) {
          lastSent = sent;
          lastProgressAt = Date.now();
        } else if (Date.now() - lastProgressAt > STALL_MS) {
          throw new Error(`send stalled at ${sent}/${N} for >${STALL_MS}ms`);
        }
        await new Promise((r) => setTimeout(r, 25));
      }

      const elapsedMs = Date.now() - started;
      expect(smtp.received).toHaveLength(N);
      expect(
        (h.db.prepare("SELECT COUNT(*) AS n FROM sends WHERE campaign_id = ? AND state = 'sent'").get(campaignId) as {
          n: number;
        }).n,
      ).toBe(N);

      // Spot-check every message: To matches personalized subject/body.
      for (const msg of smtp.received) {
        const to = msg.to[0]!;
        const expected = byEmail.get(to);
        expect(expected, `unexpected recipient ${to}`).toBeTruthy();
        expect(msg.raw).toMatch(new RegExp(`^Subject: Hello ${expected!.first_name}$`, "m"));
        expect(msg.raw).toContain(`Hi ${expected!.first_name},`);
        expect(msg.raw).toContain("PO Box 1");
      }

      console.log(
        `[send-scale] N=${N} elapsed=${(elapsedMs / 1000).toFixed(1)}s rate=${((N / elapsedMs) * 1000).toFixed(0)}/s`,
      );
    },
    N >= 50_000 ? 650_000 : 200_000,
  );
});
