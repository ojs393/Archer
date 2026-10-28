import { describe, expect, it } from "vitest";
import {
  DASHBOARD_RANGES,
  availableRanges,
  isRangeAvailable,
  pickAvailableRange,
  rangeToQuery,
} from "./TimeRange";

describe("rangeToQuery", () => {
  it("maps short windows to minute/hour buckets and long ones to days", () => {
    expect(rangeToQuery("30m")).toEqual({ bucket: "minute", hours: 0.5 });
    expect(rangeToQuery("1h")).toEqual({ bucket: "minute", hours: 1 });
    expect(rangeToQuery("6h")).toEqual({ bucket: "hour", hours: 6 });
    expect(rangeToQuery("12h")).toEqual({ bucket: "hour", hours: 12 });
    expect(rangeToQuery("24h")).toEqual({ bucket: "hour", hours: 24 });
    expect(rangeToQuery("7d")).toEqual({ bucket: "day", days: 7 });
    expect(rangeToQuery("30d")).toEqual({ bucket: "day", days: 30 });
    expect(rangeToQuery("90d")).toEqual({ bucket: "day", days: 90 });
    expect(rangeToQuery("180d")).toEqual({ bucket: "day", days: 180 });
    expect(rangeToQuery("365d")).toEqual({ bucket: "day", days: 365 });
  });

  it("lists every range id", () => {
    expect(DASHBOARD_RANGES).toEqual(["30m", "1h", "6h", "12h", "24h", "7d", "30d", "90d", "180d", "365d"]);
  });
});

describe("availability", () => {
  const now = new Date("2026-10-28T12:00:00.000Z");

  it("hides long ranges when history is short", () => {
    const from = "2026-10-28T06:00:00.000Z"; // 6h of history
    expect(isRangeAvailable("30m", from, now)).toBe(true);
    expect(isRangeAvailable("6h", from, now)).toBe(true);
    expect(isRangeAvailable("24h", from, now)).toBe(true); // short-window rule ≤6h always; 24h needs 20%
    expect(isRangeAvailable("7d", from, now)).toBe(false);
    expect(isRangeAvailable("365d", from, now)).toBe(false);
    expect(availableRanges(from, now)).toEqual(["30m", "1h", "6h", "12h", "24h"]);
  });

  it("returns nothing with no coverage", () => {
    expect(availableRanges(null, now)).toEqual([]);
  });

  it("snaps preferred range down to the nearest available", () => {
    const from = "2026-10-27T12:00:00.000Z"; // 1 day
    expect(pickAvailableRange("365d", from, now)).toBe("24h");
    expect(pickAvailableRange("7d", from, now)).toBe("24h");
    expect(pickAvailableRange("1h", from, now)).toBe("1h");
  });
});
