import { describe, expect, it } from "vitest";
import { MIN_NODE_VERSION, checkNode, meetsMinimum, nodeInstallHint } from "../../../scripts/lib/node.mjs";

describe("meetsMinimum", () => {
  it("requires Node 22.13.0", () => {
    expect(MIN_NODE_VERSION).toBe("22.13.0");
  });

  it.each([
    ["22.12.0", false],
    ["v22.12.9", false],
    ["20.18.1", false],
    ["22.13.0", true],
    ["v22.13.0", true],
    ["22.20.1", true],
    ["24.1.0", true],
  ])("%s -> %s", (version, expected) => {
    expect(meetsMinimum(version)).toBe(expected);
  });

  it("compares numerically, not lexically", () => {
    expect(meetsMinimum("22.9.0", "22.13.0")).toBe(false);
    expect(meetsMinimum("100.0.0", "22.13.0")).toBe(true);
  });
});

describe("checkNode", () => {
  it("passes a supported version", () => {
    expect(checkNode("22.13.0", "darwin")).toEqual({ status: "PASS", name: "node", detail: "v22.13.0" });
  });

  it("fails an old version fatally with the platform install hint", () => {
    expect(checkNode("20.18.1", "win32")).toEqual({
      status: "FAIL",
      name: "node",
      detail: "v20.18.1; Archer needs >= 22.13.0",
      hint: "winget install OpenJS.NodeJS.LTS",
      fatal: true,
    });
  });
});

describe("nodeInstallHint", () => {
  it("suggests Homebrew on macOS", () => {
    expect(nodeInstallHint("darwin")).toContain("brew install node@22");
  });
  it("suggests winget on Windows", () => {
    expect(nodeInstallHint("win32")).toContain("winget install OpenJS.NodeJS.LTS");
  });
  it("suggests nvm on Linux", () => {
    expect(nodeInstallHint("linux")).toContain("nvm install 22");
  });
});
