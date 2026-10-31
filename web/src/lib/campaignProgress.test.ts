import { describe, expect, it } from "vitest";
import { campaignDoneCount, campaignProgress } from "./campaignProgress";

const base = {
  pending: 2,
  sending: 1,
  sent: 10,
  retry: 0,
  failed: 1,
  uncertain: 1,
  skipped_suppressed: 2,
  total: 16,
};

describe("campaignProgress", () => {
  it("counts all terminal outcomes as done", () => {
    expect(campaignDoneCount(base)).toBe(14);
    expect(campaignProgress(base)).toEqual({
      done: 14,
      total: 16,
      ratio: 14 / 16,
      label: "14 of 16",
    });
  });

  it("handles empty campaigns", () => {
    expect(campaignProgress({ ...base, total: 0, sent: 0, failed: 0, uncertain: 0, skipped_suppressed: 0 })).toMatchObject({
      done: 0,
      total: 0,
      ratio: null,
      label: "—",
    });
  });
});
