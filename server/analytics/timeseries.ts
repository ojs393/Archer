import type { DatabaseSync } from "node:sqlite";
import type { AnalyticsBucket, AnalyticsPoint, AnalyticsTimeseries } from "../http/contract.ts";
import { eventCoverageFrom } from "./coverage.ts";

export const MAX_POINTS = 2_160;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const OUTCOMES = ["sent", "failed", "suppressed", "retry", "uncertain"] as const;
type Outcome = (typeof OUTCOMES)[number];

// created_at is ISO-8601 UTC, so a prefix is the bucket: "YYYY-MM-DDTHH" for hours, "YYYY-MM-DD" for days.
const KEY_LENGTH: Record<AnalyticsBucket, number> = { hour: 13, day: 10 };

function bucketStart(now: Date, bucket: AnalyticsBucket): number {
  const ms = bucket === "hour" ? HOUR_MS : DAY_MS;
  return Math.floor(now.getTime() / ms) * ms;
}

export function analyticsTimeseries(
  db: DatabaseSync,
  q: { bucket: AnalyticsBucket; days: number; campaignId: number | null },
  now: Date = new Date(),
): AnalyticsTimeseries {
  const step = q.bucket === "hour" ? HOUR_MS : DAY_MS;
  const count = Math.min(MAX_POINTS, q.bucket === "hour" ? q.days * 24 : q.days);
  const first = bucketStart(now, q.bucket) - (count - 1) * step;
  const points: AnalyticsPoint[] = [];
  const byKey = new Map<string, AnalyticsPoint>();
  for (let i = 0; i < count; i++) {
    const t = new Date(first + i * step).toISOString();
    const point: AnalyticsPoint = { t, sent: 0, failed: 0, suppressed: 0, retry: 0, uncertain: 0 };
    points.push(point);
    byKey.set(t.slice(0, KEY_LENGTH[q.bucket]), point);
  }

  const types = OUTCOMES.map(() => "?").join(",");
  const scope = q.campaignId === null ? "" : " AND campaign_id = ?";
  const params: (string | number)[] = [KEY_LENGTH[q.bucket], ...OUTCOMES, new Date(first).toISOString()];
  if (q.campaignId !== null) params.push(q.campaignId);
  const rows = db
    .prepare(
      `SELECT substr(created_at, 1, ?) AS k, type, COUNT(*) AS n FROM events
       WHERE type IN (${types}) AND created_at >= ?${scope}
       GROUP BY k, type`,
    )
    .all(...params) as { k: string; type: Outcome; n: number }[];
  for (const { k, type, n } of rows) {
    const point = byKey.get(k);
    if (point) point[type] += n;
  }
  return { bucket: q.bucket, coverageFrom: eventCoverageFrom(db, q.campaignId), points };
}
