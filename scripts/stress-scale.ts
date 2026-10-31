/**
 * Progressive import → enqueue → send stress (real Archer modules).
 * Usage:
 *   npm run test:stress
 *   STRESS_NS=10000,50000,100000 npm run test:stress
 *   STRESS_SEND=1 STRESS_NS=10000,50000 npm run test:stress
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCampaign, eventsPage } from "../server/campaigns/store.ts";
import { campaignCounts, getCampaignView, listCampaignViews } from "../server/campaigns/view.ts";
import { openDb } from "../server/db/index.ts";
import { MAX_DAILY_CAP, type Schedule } from "../server/domain/schedule.ts";
import { streamImport } from "../server/import/csv.ts";
import { listContacts } from "../server/import/contacts.ts";
import { createList, getList, listLists } from "../server/import/lists.ts";
import { SendWorker, type SenderConfig } from "../server/send/worker.ts";
import { freeGiB, MIN_FREE_GIB_FOR_STRESS } from "../server/system/diskSpace.ts";
import { pickContact, previewTemplate } from "../server/templates/render.ts";
import { createTemplate, getTemplate } from "../server/templates/store.ts";
import { startFakeSmtp, type FakeSmtp } from "../server/testing/fakeSmtp.ts";
import { writeAudienceCsv } from "../tests/helpers/generateAudience.ts";

const MB = 1024 * 1024;
const SEND = process.env.STRESS_SEND === "1";
const NS = (process.env.STRESS_NS ?? "10000,50000,100000,300000")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const SCHEDULE: Schedule = {
  timezone: "UTC",
  sendDays: [0, 1, 2, 3, 4, 5, 6],
  startTime: "00:00",
  endTime: "23:59",
  dailyCap: MAX_DAILY_CAP,
  warmup: false,
  delaySeconds: 1,
};

type Mem = { heapMb: number; rssMb: number; externalMb: number };

function mem(): Mem {
  const m = process.memoryUsage();
  return {
    heapMb: m.heapUsed / MB,
    rssMb: m.rss / MB,
    externalMb: m.external / MB,
  };
}

function dbBytes(dir: string): number {
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith("app.db")) continue;
    total += fs.statSync(path.join(dir, name)).size;
  }
  return total;
}

function log(line: string): void {
  console.log(line);
}

async function exerciseApis(db: ReturnType<typeof openDb>, listId: number, campaignId: number, templateId: number): Promise<string[]> {
  const gaps: string[] = [];
  try {
    const lists = listLists(db);
    if (!lists.some((l) => l.id === listId)) gaps.push("listLists missing list");
  } catch (e) {
    gaps.push(`listLists: ${(e as Error).message}`);
  }
  try {
    const page = listContacts(db, listId, { limit: 50, offset: 0 });
    if (page.contacts.length === 0 || page.total <= 0) gaps.push("listContacts empty");
  } catch (e) {
    gaps.push(`listContacts: ${(e as Error).message}`);
  }
  try {
    const views = listCampaignViews(db, { limit: 500 });
    if (!views.campaigns.some((v) => v.id === campaignId)) gaps.push("listCampaignViews missing campaign");
  } catch (e) {
    gaps.push(`listCampaignViews: ${(e as Error).message}`);
  }
  try {
    const view = getCampaignView(db, campaignId);
    if (!view) gaps.push("getCampaignView null");
  } catch (e) {
    gaps.push(`getCampaignView: ${(e as Error).message}`);
  }
  try {
    const counts = campaignCounts(db, campaignId);
    if (counts.total <= 0) gaps.push("campaignCounts total 0");
  } catch (e) {
    gaps.push(`campaignCounts: ${(e as Error).message}`);
  }
  try {
    const t = getTemplate(db, templateId);
    const contact = pickContact(db, listId, "first");
    if (!t || !contact) gaps.push("preview missing template/contact");
    else {
      const p = previewTemplate(
        t,
        contact,
        {
          smtp: { host: "127.0.0.1", port: 25, secure: false, user: "", pass: "" },
          fromName: "Stress",
          fromEmail: "a@b.example",
          replyTo: null,
          postalAddress: "PO Box 1",
          unsubMailbox: "u@b.example",
          publicBaseUrl: null,
          unsubSecret: "s".repeat(64),
        },
        "2026-10-26",
      );
      if (!p.email) gaps.push("preview missing email");
    }
  } catch (e) {
    gaps.push(`preview: ${(e as Error).message}`);
  }
  try {
    eventsPage(db, campaignId, { limit: 20 });
  } catch (e) {
    gaps.push(`eventsPage: ${(e as Error).message}`);
  }
  return gaps;
}

async function runOne(n: number): Promise<{ ok: boolean; detail: string }> {
  if (freeGiB(os.tmpdir()) < MIN_FREE_GIB_FOR_STRESS && n >= 100_000) {
    return {
      ok: false,
      detail: `skip N=${n}: free disk ${freeGiB(os.tmpdir()).toFixed(2)} GiB < ${MIN_FREE_GIB_FOR_STRESS}`,
    };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `archer-stress-${n}-`));
  const csvPath = path.join(dir, "audience.csv");
  const dbPath = path.join(dir, "app.db");
  let smtp: FakeSmtp | null = null;
  let worker: SendWorker | null = null;
  const t0 = Date.now();
  const baseline = mem();
  let peakRss = baseline.rssMb;
  const tick = () => {
    peakRss = Math.max(peakRss, mem().rssMb);
  };

  try {
    log(`\n=== N=${n.toLocaleString("en-US")} dir=${dir} freeDisk=${freeGiB(dir).toFixed(2)}GiB ===`);
    await writeAudienceCsv(csvPath, n);
    tick();
    const csvMb = fs.statSync(csvPath).size / MB;
    log(`  csv=${csvMb.toFixed(1)}MB write=${((Date.now() - t0) / 1000).toFixed(1)}s mem=${JSON.stringify(mem())}`);

    const db = openDb(dbPath);
    const listId = createList(db, {
      name: `stress-${n}`,
      sourceLabel: "stress",
      consentText: "stress consent",
      excludeRoles: true,
    });
    const importStarted = Date.now();
    const imported = await streamImport({
      filePath: csvPath,
      db,
      listId,
      excludeRoles: true,
      domainChecker: null,
      onProgress: () => tick(),
    });
    tick();
    const list = getList(db, listId)!;
    log(
      `  import valid=${imported.valid} elapsed=${((Date.now() - importStarted) / 1000).toFixed(1)}s db=${(dbBytes(dir) / MB).toFixed(1)}MB peakRss=${peakRss.toFixed(0)}MB`,
    );
    if (imported.valid !== n || list.valid_count !== n) {
      return { ok: false, detail: `import mismatch valid=${imported.valid} list.valid=${list.valid_count}` };
    }

    const templateId = createTemplate(db, {
      name: "Stress",
      subject: "Hello {{first_name}}",
      html: "<p>Hi {{first_name}},</p><p>{{postal_address}}</p><p>{{unsubscribe_url}}</p>",
    });
    // Mark template tested so gates aren't needed for worker-direct path.
    db.prepare("UPDATE templates SET last_test_ok_version = version WHERE id = ?").run(templateId);

    const enqueueStarted = Date.now();
    const campaignId = await createCampaign(db, {
      listId,
      templateId,
      templateVersion: 1,
      schedule: SCHEDULE,
    });
    tick();
    const counts = campaignCounts(db, campaignId);
    log(
      `  enqueue campaign=${campaignId} pending=${counts.pending} total=${counts.total} elapsed=${((Date.now() - enqueueStarted) / 1000).toFixed(1)}s db=${(dbBytes(dir) / MB).toFixed(1)}MB peakRss=${peakRss.toFixed(0)}MB`,
    );
    if (counts.total !== n) {
      return { ok: false, detail: `enqueue total ${counts.total} !== ${n}` };
    }

    const apiStarted = Date.now();
    const gaps = await exerciseApis(db, listId, campaignId, templateId);
    tick();
    log(`  apis elapsed=${Date.now() - apiStarted}ms gaps=${gaps.length ? gaps.join("; ") : "none"}`);

    if (SEND) {
      smtp = await startFakeSmtp();
      // Cap retained MIME bodies so the harness doesn't OOM before the product does.
      const KEEP_RAW = Math.min(200, n);
      const origPush = smtp.received.push.bind(smtp.received);
      smtp.received.push = ((...items: (typeof smtp.received)[number][]) => {
        const r = origPush(...items);
        while (smtp!.received.length > KEEP_RAW) smtp!.received.shift();
        return r;
      }) as typeof smtp.received.push;

      let nowMs = Date.parse("2026-10-26T10:00:00Z");
      const sender = (): SenderConfig => ({
        smtp: {
          host: "127.0.0.1",
          port: smtp!.port,
          secure: false,
          user: "test",
          pass: "test",
          connectionTimeoutMs: 2000,
          greetingTimeoutMs: 2000,
          socketTimeoutMs: 5000,
        },
        fromName: "Archer Stress",
        fromEmail: "hello@mama.example",
        replyTo: null,
        postalAddress: "PO Box 1",
        unsubMailbox: "unsub@mama.example",
        publicBaseUrl: null,
        unsubSecret: randomBytes(32).toString("hex"),
      });

      worker = new SendWorker({
        db,
        getSenderConfig: sender,
        now: () => new Date(nowMs),
        sleep: async (ms) => {
          nowMs += ms;
          await new Promise<void>((r) => setImmediate(r));
        },
        random: () => 0.5,
        probeNetwork: async () => true,
        retryDelaysMs: [1, 1, 1, 1, 1],
        sendTimeoutMs: 3000,
        networkProbeIntervalMs: 10,
        eventLog: { keep: 5_000, trimEvery: 1_000 },
      });

      const sendStarted = Date.now();
      worker.start(campaignId);
      let lastSent = 0;
      let lastProgressAt = Date.now();
      const STALL_MS = n >= 50_000 ? 180_000 : 60_000;
      // Large N slows (~100/s) as tokens/DB grow; allow ~50/s worst case, capped at 75m.
      const HARD_MS = Math.min(4_500_000, Math.max(180_000, Math.ceil(n / 50) * 1000));

      while (
        (db.prepare("SELECT status FROM campaigns WHERE id = ?").get(campaignId) as { status: string }).status !==
        "completed"
      ) {
        if (Date.now() - sendStarted > HARD_MS) throw new Error(`send timeout ${HARD_MS}ms`);
        tick();
        const row = db
          .prepare(
            `SELECT
               SUM(CASE WHEN state='sent' THEN 1 ELSE 0 END) AS sent,
               SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) AS failed,
               SUM(CASE WHEN state='retry' THEN 1 ELSE 0 END) AS retry
             FROM sends WHERE campaign_id = ?`,
          )
          .get(campaignId) as { sent: number; failed: number; retry: number };
        const sent = row.sent ?? 0;
        const done = sent + (row.failed ?? 0);
        if (done > lastSent) {
          lastSent = done;
          lastProgressAt = Date.now();
          if (sent % Math.max(1_000, Math.floor(n / 10)) === 0 || sent === n) {
            log(
              `  send progress sent=${sent} failed=${row.failed} retry=${row.retry}/${n} rss=${mem().rssMb.toFixed(0)}MB db=${(dbBytes(dir) / MB).toFixed(1)}MB`,
            );
          }
        } else if (Date.now() - lastProgressAt > STALL_MS) {
          throw new Error(`stalled at sent=${sent} failed=${row.failed} retry=${row.retry}/${n}`);
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      const sentFinal = (
        db.prepare("SELECT COUNT(*) AS c FROM sends WHERE campaign_id = ? AND state = 'sent'").get(campaignId) as {
          c: number;
        }
      ).c;
      const tokens = (db.prepare("SELECT COUNT(*) AS c FROM unsubscribe_tokens").get() as { c: number }).c;
      const events = (db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number }).c;
      log(
        `  send done sent=${sentFinal} tokens=${tokens} eventsKept=${events} elapsed=${((Date.now() - sendStarted) / 1000).toFixed(1)}s peakRss=${peakRss.toFixed(0)}MB db=${(dbBytes(dir) / MB).toFixed(1)}MB smtpKept=${smtp.received.length}`,
      );
      if (sentFinal !== n) return { ok: false, detail: `sent ${sentFinal} !== ${n}` };

      // Spot-check retained MIME for personalization.
      for (const msg of smtp.received.slice(0, 20)) {
        const to = msg.to[0]!;
        const m = /^user(\d+)@/.exec(to);
        if (!m) return { ok: false, detail: `bad to ${to}` };
        const first = `Name${m[1]}`;
        if (!msg.raw.includes(`Hello ${first}`) || !msg.raw.includes(`Hi ${first},`)) {
          return { ok: false, detail: `personalization fail for ${to}` };
        }
      }
    }

    if (gaps.length) return { ok: false, detail: `api gaps: ${gaps.join("; ")}` };
    return {
      ok: true,
      detail: `peakRss=${peakRss.toFixed(0)}MB db=${(dbBytes(dir) / MB).toFixed(1)}MB total=${((Date.now() - t0) / 1000).toFixed(1)}s`,
    };
  } catch (e) {
    return { ok: false, detail: (e as Error).stack ?? String(e) };
  } finally {
    if (worker) await worker.shutdown(5_000).catch(() => {});
    if (smtp) await smtp.close().catch(() => {});
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    if (typeof globalThis.gc === "function") globalThis.gc();
  }
}

async function main(): Promise<void> {
  // Fake smtp-server uses a self-signed cert that Node rejects unless tests opt in
  // (same as vitest harness). Without this, every deliver retries on "certificate has expired".
  const prevSmtp = process.env.ARCHER_TEST_SMTP;
  process.env.ARCHER_TEST_SMTP = "1";
  log(`stress-scale NS=${NS.join(",")} SEND=${SEND} freeDisk=${freeGiB(os.tmpdir()).toFixed(2)}GiB rss0=${mem().rssMb.toFixed(0)}MB`);
  if (freeGiB(os.tmpdir()) < MIN_FREE_GIB_FOR_STRESS) {
    log(`WARN: free disk under ${MIN_FREE_GIB_FOR_STRESS} GiB — large N may be skipped or fail with ENOSPC`);
  }
  const results: { n: number; ok: boolean; detail: string }[] = [];
  try {
  for (const n of NS) {
    const r = await runOne(n);
    results.push({ n, ...r });
    log(`  RESULT N=${n} ok=${r.ok} ${r.detail}`);
    if (!r.ok && /ENOSPC|no space|disk/i.test(r.detail)) {
      log("stopping: disk pressure");
      break;
    }
  }
  log("\n=== SUMMARY ===");
  for (const r of results) log(`N=${r.n}\tok=${r.ok}\t${r.detail}`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
  } finally {
    if (prevSmtp === undefined) delete process.env.ARCHER_TEST_SMTP;
    else process.env.ARCHER_TEST_SMTP = prevSmtp;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
