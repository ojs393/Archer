import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { maybeQueueNextChainStep } from "../../server/chains/advance.ts";
import { createChain, getChain, listChains } from "../../server/chains/store.ts";
import { createCampaign } from "../../server/campaigns/store.ts";
import { runMigrations } from "../../server/db/migrate.ts";
import { createList } from "../../server/import/lists.ts";
import type { Schedule } from "../../server/domain/schedule.ts";

let dir: string;
let db: DatabaseSync;

const SCHEDULE: Schedule = {
  timezone: "UTC",
  sendDays: [0, 1, 2, 3, 4, 5, 6],
  startTime: "00:00",
  endTime: "23:59",
  dailyCap: 100,
  warmup: false,
  delaySeconds: 1,
};

function open(): DatabaseSync {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-chains-"));
  db = new DatabaseSync(path.join(dir, "t.db"));
  runMigrations(db);
  return db;
}

afterEach(() => {
  try {
    db?.close();
  } catch {
    /* closed */
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function seed(): { listId: number; t1: number; t2: number } {
  open();
  const listId = createList(db, { name: "L", sourceLabel: "csv", consentText: "ok", excludeRoles: true });
  db.prepare("UPDATE lists SET status = 'ready', valid_count = 1 WHERE id = ?").run(listId);
  db.prepare("INSERT INTO contacts (list_id, email, domain) VALUES (?, 'a@x.example', 'x.example')").run(listId);
  const t1 = Number(db.prepare("INSERT INTO templates (name, subject, html) VALUES ('A','s','<p>a</p>')").run().lastInsertRowid);
  const t2 = Number(db.prepare("INSERT INTO templates (name, subject, html) VALUES ('B','s','<p>b</p>')").run().lastInsertRowid);
  return { listId, t1, t2 };
}

describe("chains", () => {
  it("creates and lists a chain with steps", () => {
    const { listId, t1, t2 } = seed();
    const id = createChain(db, {
      name: "Welcome",
      listId,
      schedule: SCHEDULE,
      steps: [
        { templateId: t1, delayHours: 0 },
        { templateId: t2, delayHours: 24 },
      ],
    });
    const chain = getChain(db, id)!;
    expect(chain.name).toBe("Welcome");
    expect(chain.steps).toHaveLength(2);
    expect(listChains(db)[0].stepCount).toBe(2);
  });

  it("queues the next step when a chain campaign completes", async () => {
    const { listId, t1, t2 } = seed();
    const chainId = createChain(db, {
      name: "Welcome",
      listId,
      schedule: SCHEDULE,
      steps: [
        { templateId: t1, delayHours: 0 },
        { templateId: t2, delayHours: 0 },
      ],
    });
    const firstId = await createCampaign(db, { listId, templateId: t1, templateVersion: 1, schedule: SCHEDULE });
    db.prepare("UPDATE campaigns SET chain_id = ?, chain_step = 0, status = 'completed' WHERE id = ?").run(chainId, firstId);
    const next = await maybeQueueNextChainStep(db, firstId);
    expect(next?.autoStart).toBe(true);
    expect(next?.nextCampaignId).toBeGreaterThan(firstId);
    const row = db.prepare("SELECT template_id AS tid, chain_step AS step FROM campaigns WHERE id = ?").get(next!.nextCampaignId) as {
      tid: number;
      step: number;
    };
    expect(row).toEqual({ tid: t2, step: 1 });
  });
});
