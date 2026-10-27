import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { createCampaign } from "./campaigns/store.ts";
import { campaignCounts } from "./campaigns/view.ts";
import { openDb } from "./db/index.ts";
import type { Schedule } from "./domain/schedule.ts";
import { streamImport } from "./import/csv.ts";
import { createList } from "./import/lists.ts";
import { nextTurn } from "./send/async.ts";
import { ACTIVE_STATUSES, type CampaignStatus } from "./send/sendState.ts";
import { SendWorker, type SenderConfig, type WorkerEvent } from "./send/worker.ts";
import { createTemplate } from "./templates/store.ts";
import { startFakeSmtp, type FakeSmtp } from "./testing/fakeSmtp.ts";

const RUN_TIMEOUT_MS = 25_000;
const EXIT_GRACE_MS = 5_000;
const CLOCK_START = Date.parse("2026-01-07T12:00:00Z");
const POSTAL = "Archer self-test, PO Box 0, Nowhere";
const CSV = "email,first_name\r\nann@selftest.example,Ann\r\nbob@selftest.example,\r\ncy@selftest.example,Cy\r\n";
const EXPECTED_SUBJECTS = ["Hello Ann", "Hello Cy", "Hello there"];
const SCHEDULE: Schedule = {
  timezone: "UTC",
  sendDays: [0, 1, 2, 3, 4, 5, 6],
  startTime: "00:00",
  endTime: "23:59",
  dailyCap: 100,
  warmup: false,
  delaySeconds: 1,
};

type Log = (line: string) => void;

function unfold(raw: string): string {
  return raw.replace(/\r?\n[ \t]+/g, " ");
}

function decodedBody(raw: string): string {
  return raw.replace(/=\r?\n/g, "");
}

function campaignStatus(db: DatabaseSync, id: number): CampaignStatus | null {
  const row = db.prepare("SELECT status FROM campaigns WHERE id = ?").get(id) as { status: CampaignStatus } | undefined;
  return row?.status ?? null;
}

function untilSettled(worker: SendWorker, db: DatabaseSync, campaignId: number, timeoutMs: number): Promise<CampaignStatus | "timeout"> {
  return new Promise((resolve) => {
    const finish = (result: CampaignStatus | "timeout") => {
      clearTimeout(timer);
      worker.off("event", onEvent);
      resolve(result);
    };
    const onEvent = (e: WorkerEvent) => {
      if (e.type !== "status") return;
      const status = campaignStatus(db, campaignId);
      if (status && !ACTIVE_STATUSES.has(status)) finish(status);
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    worker.on("event", onEvent);
  });
}

async function sendMiniCampaign(dir: string, smtp: FakeSmtp, check: (name: string, ok: boolean, detail: string) => void): Promise<void> {
  const db = openDb(path.join(dir, "selftest.db"));
  let worker: SendWorker | null = null;
  try {
    const csvPath = path.join(dir, "list.csv");
    fs.writeFileSync(csvPath, CSV);
    const listId = createList(db, { name: "Self-test", sourceLabel: "self-test", consentText: "Self-test addresses", excludeRoles: true });
    const imported = await streamImport({ filePath: csvPath, db, listId, excludeRoles: true, domainChecker: null });
    check("import", imported.valid === 3, `${imported.valid} of 3 rows imported`);

    const templateId = createTemplate(db, {
      name: "Self-test",
      subject: "Hello {{first_name | there}}",
      html: "<p>Hi {{first_name | there}},</p><p>This is the Archer self-test.</p>",
    });
    const campaignId = await createCampaign(db, { listId, templateId, templateVersion: 1, schedule: SCHEDULE });

    const sender: SenderConfig = {
      smtp: { host: "127.0.0.1", port: smtp.port, secure: false, user: "test", pass: "test", connectionTimeoutMs: 5_000, greetingTimeoutMs: 5_000, socketTimeoutMs: 10_000 },
      fromName: "Archer self-test",
      fromEmail: "sender@selftest.example",
      replyTo: null,
      postalAddress: POSTAL,
      unsubMailbox: "unsubscribe@selftest.example",
      publicBaseUrl: null,
      unsubSecret: randomBytes(32).toString("hex"),
    };
    let nowMs = CLOCK_START;
    worker = new SendWorker({
      db,
      getSenderConfig: () => sender,
      now: () => new Date(nowMs),
      sleep: async (ms) => {
        nowMs += ms;
        await nextTurn();
      },
      random: () => 0.5,
      probeNetwork: async () => true,
      sendTimeoutMs: 10_000,
    });
    const settled = untilSettled(worker, db, campaignId, RUN_TIMEOUT_MS);
    worker.start(campaignId);
    const status = await settled;
    check("campaign completed", status === "completed", `final status ${status}`);

    const counts = campaignCounts(db, campaignId);
    check("3 sent", counts.sent === 3, `${counts.sent} sent, ${counts.failed} failed, ${counts.uncertain} uncertain`);
    check("3 received", smtp.received.length === 3, `${smtp.received.length} messages reached the fake SMTP server`);
    const subjects = smtp.received.map((m) => /^Subject: (.*)$/m.exec(unfold(m.raw))?.[1]?.trim() ?? "").sort();
    check("personalized", JSON.stringify(subjects) === JSON.stringify(EXPECTED_SUBJECTS), `subjects ${JSON.stringify(subjects)}`);
    const withHeader = smtp.received.filter((m) => /^List-Unsubscribe: <mailto:unsubscribe@selftest\.example\?/m.test(unfold(m.raw)));
    check("List-Unsubscribe", withHeader.length === 3, `${withHeader.length} of 3 messages carry the header`);
    const withFooter = smtp.received.filter((m) => {
      const body = decodedBody(m.raw);
      return body.includes(POSTAL) && body.includes("Unsubscribe");
    });
    check("footer", withFooter.length === 3, `${withFooter.length} of 3 messages carry the postal address and unsubscribe link`);
  } finally {
    await worker?.shutdown(1_000);
    db.close();
  }
}

export async function runSelfTest(log: Log = (line) => console.log(line)): Promise<boolean> {
  const previous = process.env.ARCHER_TEST_SMTP;
  process.env.ARCHER_TEST_SMTP = "1";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-selftest-"));
  log(`Self-test directory: ${dir}`);
  let failures = 0;
  const check = (name: string, ok: boolean, detail: string) => {
    if (!ok) failures += 1;
    log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  };
  let smtp: FakeSmtp | null = null;
  try {
    smtp = await startFakeSmtp();
    await sendMiniCampaign(dir, smtp, check);
  } catch (err) {
    check("self-test", false, err instanceof Error ? err.message : String(err));
  } finally {
    await smtp?.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.ARCHER_TEST_SMTP;
    else process.env.ARCHER_TEST_SMTP = previous;
  }
  const ok = failures === 0;
  log(ok ? "PASS self-test: a 3-message campaign went through the local fake SMTP server" : `FAIL self-test: ${failures} check(s) failed`);
  return ok;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runSelfTest().then(
    (ok) => {
      process.exitCode = ok ? 0 : 1;
      setTimeout(() => process.exit(process.exitCode), EXIT_GRACE_MS).unref();
    },
    (err: unknown) => {
      console.error("FAIL self-test:", err);
      process.exit(1);
    },
  );
}
