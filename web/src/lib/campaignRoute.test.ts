import { describe, expect, it } from "vitest";
import { campaignHash, parseAppRoute } from "./campaignRoute";

describe("parseAppRoute", () => {
  it("parses campaign ids and tabs", () => {
    expect(parseAppRoute("#/campaigns/12")).toEqual({ kind: "campaign", id: 12, tab: "overview" });
    expect(parseAppRoute("#/campaigns/12/sends")).toEqual({ kind: "campaign", id: 12, tab: "sends" });
  });

  it("maps legacy runs?id= to a campaign route", () => {
    expect(parseAppRoute("#/runs?id=7")).toEqual({ kind: "campaign", id: 7, tab: "overview" });
  });

  it("falls back to shell tabs or not-found", () => {
    expect(parseAppRoute("#/audience")).toEqual({ kind: "tab", tab: "audience" });
    expect(parseAppRoute("#/chains")).toEqual({ kind: "chains" });
    expect(parseAppRoute("#/nope")).toEqual({ kind: "notfound" });
    expect(parseAppRoute("#/")).toEqual({ kind: "tab", tab: "dashboard" });
  });
});

describe("campaignHash", () => {
  it("omits the default overview segment", () => {
    expect(campaignHash(3)).toBe("#/campaigns/3");
    expect(campaignHash(3, "configure")).toBe("#/campaigns/3/configure");
  });
});
