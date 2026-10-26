import { describe, expect, it } from "vitest";
import { campaignStatusView, healthStatusView } from "./status";

describe("campaignStatusView", () => {
  it("shows Idle without a campaign", () => {
    expect(campaignStatusView(null)).toEqual({ label: "Idle", tone: "neutral" });
  });

  it.each([
    ["running", "Sending", "ok"],
    ["paused", "Paused", "warn"],
    ["safety_stop", "Safety stop", "error"],
    ["waiting_window", "Waiting", "info"],
    ["waiting_network", "Offline", "warn"],
    ["completed", "Completed", "neutral"],
  ])("maps %s to %s (%s)", (status, label, tone) => {
    expect(campaignStatusView(status)).toMatchObject({ label, tone });
  });

  it("never breaks on a status it does not know", () => {
    expect(campaignStatusView("archived")).toEqual({ label: "archived", tone: "neutral" });
    expect(campaignStatusView("toString")).toEqual({ label: "toString", tone: "neutral" });
  });
});

describe("healthStatusView", () => {
  it("maps ok, fail and unknown", () => {
    expect(healthStatusView("ok").tone).toBe("ok");
    expect(healthStatusView("fail").tone).toBe("error");
    expect(healthStatusView("unknown").tone).toBe("neutral");
    expect(healthStatusView(undefined).label).toBe("Not checked");
  });
});
