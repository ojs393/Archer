import { afterEach, describe, expect, it } from "vitest";
import { canonicaliseTabHash, DEFAULT_TAB, navigateToTab, parseTabHash, tabHash, TAB_IDS } from "./tabs";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("tab hash routing", () => {
  it("has exactly the five app tabs, dashboard first", () => {
    expect(TAB_IDS).toEqual(["dashboard", "runs", "audience", "templates", "settings"]);
    expect(DEFAULT_TAB).toBe("dashboard");
  });

  it.each([
    ["#/runs", "runs"],
    ["#/templates", "templates"],
    ["#/Settings", "settings"],
    ["#/audience/12", "audience"],
    ["#/runs?x=1", "runs"],
    ["#runs", "runs"],
  ])("parses %s as %s", (hash, tab) => {
    expect(parseTabHash(hash)).toBe(tab);
  });

  it.each(["", "#", "#/", "#/nope", "#/__proto__", "#/constructor"])("falls back to the dashboard for %j", (hash) => {
    expect(parseTabHash(hash)).toBe("dashboard");
  });

  it("builds the canonical hash", () => {
    expect(tabHash("audience")).toBe("#/audience");
  });

  it("can navigate without adding a history entry", () => {
    const before = window.history.length;
    navigateToTab("runs", { replace: true });
    expect(window.location.hash).toBe("#/runs");
    expect(window.history.length).toBe(before);
  });

  it("canonicalises an unknown hash to the dashboard in place", () => {
    window.history.replaceState(null, "", "/?x=1#/bogus");
    const before = window.history.length;
    expect(canonicaliseTabHash()).toBe("dashboard");
    expect(window.location.hash).toBe("#/dashboard");
    expect(window.location.search).toBe("?x=1");
    expect(window.history.length).toBe(before);
  });

  it("navigates by pushing a history entry", () => {
    const before = window.history.length;
    navigateToTab("templates");
    expect(window.location.hash).toBe("#/templates");
    expect(window.history.length).toBe(before + 1);
    navigateToTab("templates");
    expect(window.history.length).toBe(before + 1);
  });
});
