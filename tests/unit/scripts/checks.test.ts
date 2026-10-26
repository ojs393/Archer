import { describe, expect, it } from "vitest";
import { auditResult } from "../../../scripts/lib/checks.mjs";

const auditJson = (high: number, critical: number) =>
  JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 3, moderate: 1, high, critical, total: 4 + high + critical } } });

const base = { timedOut: false, attempts: 1 };

describe("auditResult", () => {
  it("passes a clean audit", () => {
    expect(auditResult({ ...base, ok: true, code: 0, stdout: auditJson(0, 0) })).toEqual({
      status: "PASS",
      name: "npm audit",
      detail: "no high-severity advisories",
    });
  });

  it("warns with the high + critical count when advisories are found", () => {
    expect(auditResult({ ...base, ok: false, code: 1, stdout: auditJson(1, 2) })).toEqual({
      status: "WARN",
      name: "npm audit",
      detail: "3 high/critical advisories; run npm audit for details",
    });
  });

  it("uses the singular for one advisory", () => {
    expect(auditResult({ ...base, ok: false, code: 1, stdout: auditJson(1, 0) }).detail).toBe(
      "1 high/critical advisory; run npm audit for details",
    );
  });

  it("warns, without failing, when the audit could not run", () => {
    expect(auditResult({ ...base, ok: false, code: 1, stdout: "not json" })).toEqual({
      status: "WARN",
      name: "npm audit",
      detail: "could not complete (exit code 1); run npm audit for details",
    });
  });

  it("skips on timeout", () => {
    expect(auditResult({ ...base, ok: false, code: null, timedOut: true })).toEqual({
      status: "SKIP",
      name: "npm audit",
      detail: "timed out",
    });
  });
});
