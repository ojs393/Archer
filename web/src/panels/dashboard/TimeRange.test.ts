import { describe, expect, it } from "vitest";
import { DASHBOARD_RANGES, rangeToQuery } from "./TimeRange";

describe("rangeToQuery", () => {
  it("maps every dashboard range to bucket + days", () => {
    expect(rangeToQuery("24h")).toEqual({ bucket: "hour", days: 1 });
    expect(rangeToQuery("7d")).toEqual({ bucket: "day", days: 7 });
    expect(rangeToQuery("30d")).toEqual({ bucket: "day", days: 30 });
    expect(rangeToQuery("90d")).toEqual({ bucket: "day", days: 90 });
    expect(DASHBOARD_RANGES).toEqual(["24h", "7d", "30d", "90d"]);
  });
});
