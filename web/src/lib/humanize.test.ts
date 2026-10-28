import { describe, expect, it } from "vitest";
import { humanizeKey, plainValue } from "./humanize";

describe("humanizeKey", () => {
  it("formats snake and kebab keys", () => {
    expect(humanizeKey("first_name")).toBe("First Name");
    expect(humanizeKey("company-name")).toBe("Company Name");
  });
});

describe("plainValue", () => {
  it("uses an em dash for empties", () => {
    expect(plainValue("")).toBe("—");
    expect(plainValue(null)).toBe("—");
    expect(plainValue("Ann")).toBe("Ann");
  });
});
