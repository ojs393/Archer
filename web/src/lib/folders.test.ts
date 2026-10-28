import { describe, expect, it } from "vitest";
import { folderLabel, folderOptions, folderTag, isFolderTag } from "./folders";

describe("folders", () => {
  it("detects and formats folder tags", () => {
    expect(isFolderTag("folder:Warmup")).toBe(true);
    expect(isFolderTag("vip")).toBe(false);
    expect(folderLabel("folder:Warmup")).toBe("Warmup");
    expect(folderTag(" Q4 ")).toBe("folder:q4");
  });

  it("builds folder select options", () => {
    expect(folderOptions([{ name: "vip" }, { name: "folder:B" }, { name: "folder:A" }])).toEqual([
      { value: "folder:A", label: "A" },
      { value: "folder:B", label: "B" },
    ]);
  });
});
