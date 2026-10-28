import { describe, expect, it } from "vitest";
import {
  DASHBOARD_RANGES,
  RANGE_DEFS,
  availableRanges,
  expectedPointCount,
  isRangeAvailable,
  pickAvailableRange,
  rangeToQuery,
} from "./TimeRange";

describe("rangeToQuery", () => {
  it("maps every range to a concrete bucket query", () => {
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

  it("lists every range id once", () => {
    expect(DASHBOARD_RANGES).toEqual(["30m", "1h", "6h", "12h", "24h", "7d", "30d", "90d", "180d", "365d"]);
    expect(RANGE_DEFS).toHaveLength(10);
  });

  it("predicts server point counts for every range", () => {
    expect(expectedPointCount("30m")).toBe(30);
    expect(expectedPointCount("1h")).toBe(60);
    expect(expectedPointCount("6h")).toBe(6);
    expect(expectedPointCount("12h")).toBe(12);
    expect(expectedPointCount("24h")).toBe(24);
    expect(expectedPointCount("7d")).toBe(7);
    expect(expectedPointCount("30d")).toBe(30);
    expect(expectedPointCount("90d")).toBe(90);
    expect(expectedPointCount("180d")).toBe(180);
    expect(expectedPointCount("365d")).toBe(365);
  });
});

describe("availability", () => {
  const now = new Date("2026-10-28T12:00:00.000Z");

  it("enables short windows with any history and longer ones at 25% fill", () => {
    const from = "2026-10-28T06:00:00.000Z"; // 6h
    expect(isRangeAvailable("30m", from, now)).toBe(true);
    expect(isRangeAvailable("24h", from, now)).toBe(true);
    expect(isRangeAvailable("7d", from, now)).toBe(false);
    expect(availableRanges(from, now)).toEqual(["30m", "1h", "6h", "12h", "24h"]);
  });

  it("returns nothing with no coverage", () => {
    expect(availableRanges(null, now)).toEqual([]);
  });

  it("snaps preferred range down once to the nearest available", () => {
    const from = "2026-10-27T12:00:00.000Z"; // 1 day
    expect(pickAvailableRange("365d", from, now)).toBe("24h");
    expect(pickAvailableRange("7d", from, now)).toBe("24h");
    expect(pickAvailableRange("1h", from, now)).toBe("1h");
  });

  it("unlocks month ranges when history is long enough", () => {
    const from = "2026-09-20T00:00:00.000Z"; // ~38 days
    expect(isRangeAvailable("30d", from, now)).toBe(true);
    expect(isRangeAvailable("90d", from, now)).toBe(true);
    expect(isRangeAvailable("180d", from, now)).toBe(false);
    expect(isRangeAvailable("365d", from, now)).toBe(false);
  });
});
