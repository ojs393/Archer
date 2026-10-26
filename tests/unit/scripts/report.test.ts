import { describe, expect, it } from "vitest";
import { formatResult } from "../../../scripts/lib/report.mjs";

describe("formatResult", () => {
  it("aligns the status column and wraps detail in parentheses", () => {
    expect(formatResult({ status: "SKIP", name: "self-test", detail: "not implemented yet" })).toBe(
      "SKIP  self-test (not implemented yet)",
    );
    expect(formatResult({ status: "FIXED", name: ".env", detail: "generated UNSUB_SECRET" })).toBe(
      "FIXED .env (generated UNSUB_SECRET)",
    );
  });

  it("aligns WARN like the other statuses", () => {
    expect(formatResult({ status: "WARN", name: "npm audit", detail: "2 high/critical advisories" })).toBe(
      "WARN  npm audit (2 high/critical advisories)",
    );
  });

  it("omits empty detail", () => {
    expect(formatResult({ status: "PASS", name: "node" })).toBe("PASS  node");
  });

  it("puts a fix hint on its own indented line", () => {
    expect(formatResult({ status: "FAIL", name: "node", detail: "v20.0.0", hint: "nvm install 22" })).toBe(
      "FAIL  node (v20.0.0)\n      fix: nvm install 22",
    );
  });
});
