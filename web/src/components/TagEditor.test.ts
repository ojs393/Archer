import { describe, expect, it } from "vitest";
import { normalizeTag } from "./TagEditor";

describe("normalizeTag", () => {
  it("lowercases plain tags", () => {
    expect(normalizeTag(" VIP ")).toBe("vip");
  });

  it("keeps folder prefix and lowercases the label", () => {
    expect(normalizeTag("folder:CRM")).toBe("folder:crm");
    expect(normalizeTag("Folder: Newsletter")).toBe("folder:newsletter");
  });
});
