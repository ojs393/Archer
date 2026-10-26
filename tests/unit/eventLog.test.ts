import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../server/db/index.ts";
import { EventLog, KEEP_EVENTS, walCheckpoint } from "../../server/send/events.ts";

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mamadirect-elog-"));
  db = openDb(path.join(dir, "app.db"));
  db.prepare(
    "INSERT INTO lists (name, source_label, consent_text, consent_at, status) VALUES ('L','s','ok','2026-01-01','ready')",
  ).run();
  db.prepare("INSERT INTO templates (name, subject, html) VALUES ('T','S','<p>x</p>')").run();
  db.prepare("INSERT INTO campaigns (list_id, template_id, template_version, schedule_json) VALUES (1, 1, 1, '{}')").run();
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function count(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
}

describe("EventLog ring", () => {
  it("exports KEEP_EVENTS = 50_000", () => {
    expect(KEEP_EVENTS).toBe(50_000);
  });

  it("keeps at most keep rows after insert N+δ and trim", () => {
    const keep = 50;
    const log = new EventLog(db, { keep, trimEvery: 10 });
    const at = "2026-10-26T12:00:00.000Z";
    for (let i = 0; i < keep + 25; i++) {
      log.insert({ type: "sent", campaignId: 1, message: `m${i}`, at });
      log.trimIfDue();
    }
    log.trimNow();
    expect(count()).toBeLessThanOrEqual(keep);
    expect(count()).toBe(keep);
  });

  it("walCheckpoint is best-effort and does not throw", () => {
    expect(() => walCheckpoint(db)).not.toThrow();
  });
});
