import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { analyticsTimeseries } from "../../server/analytics/timeseries.ts";
import { runMigrations } from "../../server/db/migrate.ts";

/** Mirrors the dashboard range → query map so server and UI stay aligned. */
const RANGES = [
  { id: "30m", bucket: "minute" as const, hours: 0.5, points: 30 },
  { id: "1h", bucket: "minute" as const, hours: 1, points: 60 },
  { id: "6h", bucket: "hour" as const, hours: 6, points: 6 },
  { id: "12h", bucket: "hour" as const, hours: 12, points: 12 },
  { id: "24h", bucket: "hour" as const, hours: 24, points: 24 },
  { id: "7d", bucket: "day" as const, days: 7, points: 7 },
  { id: "30d", bucket: "day" as const, days: 30, points: 30 },
  { id: "90d", bucket: "day" as const, days: 90, points: 90 },
  { id: "180d", bucket: "day" as const, days: 180, points: 180 },
  { id: "365d", bucket: "day" as const, days: 365, points: 365 },
];

let db: DatabaseSync;
let dir: string;

function open(): DatabaseSync {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-ts-"));
  db = new DatabaseSync(path.join(dir, "t.db"));
  runMigrations(db);
  return db;
}

afterEach(() => {
  db?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe("analyticsTimeseries ranges", () => {
  const now = new Date("2026-10-28T12:00:00.000Z");

  it("returns the expected bucket size for every dashboard range", () => {
    open();
    for (const r of RANGES) {
      const ts = analyticsTimeseries(
        db,
        { bucket: r.bucket, hours: r.hours, days: r.days, campaignId: null },
        now,
      );
      expect(ts.bucket, r.id).toBe(r.bucket);
      expect(ts.points, r.id).toHaveLength(r.points);
      for (let i = 1; i < ts.points.length; i++) {
        expect(Date.parse(ts.points[i].t)).toBeGreaterThan(Date.parse(ts.points[i - 1].t));
      }
    }
  });

  it("fills minute buckets from recent events", () => {
    open();
    db.prepare(
      `INSERT INTO lists (name, source_label, consent_text, consent_at, email_column, status, total_rows, valid_count)
       VALUES ('L','s','c',datetime('now'),'email','ready',1,1)`,
    ).run();
    db.prepare(
      `INSERT INTO templates (name, subject, html, text, variable_map_json) VALUES ('T','s','<p></p>',null,'{}')`,
    ).run();
    db.prepare(
      `INSERT INTO campaigns (list_id, template_id, template_version, status, schedule_json)
       VALUES (1,1,1,'completed','{}')`,
    ).run();
    const insert = db.prepare(
      `INSERT INTO events (campaign_id, type, message, created_at) VALUES (1, 'sent', 'x', ?)`,
    );
    insert.run("2026-10-28T11:45:00.000Z");
    insert.run("2026-10-28T11:50:00.000Z");
    insert.run("2026-10-28T11:55:00.000Z");
    const ts = analyticsTimeseries(db, { bucket: "minute", hours: 0.5, campaignId: null }, now);
    expect(ts.points).toHaveLength(30);
    const active = ts.points.filter((p) => p.sent > 0);
    expect(active.length).toBe(3);
    expect(active.map((p) => p.sent)).toEqual([1, 1, 1]);
    expect(ts.coverageFrom).toBe("2026-10-28T11:45:00.000Z");
  });
});
