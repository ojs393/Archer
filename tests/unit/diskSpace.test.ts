import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  freeBytes,
  freeGiB,
  hasFreeGiB,
  MIN_FREE_GIB_FOR_BACKUP,
  MIN_FREE_GIB_FOR_STRESS,
} from "../../server/system/diskSpace.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("diskSpace", () => {
  it("exports sensible floors", () => {
    expect(MIN_FREE_GIB_FOR_BACKUP).toBe(2);
    expect(MIN_FREE_GIB_FOR_STRESS).toBe(1.5);
  });

  it("reads free space for a real directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-disk-"));
    try {
      expect(freeBytes(dir)).toBeGreaterThan(0);
      expect(freeGiB(dir)).toBeGreaterThan(0);
      expect(hasFreeGiB(dir, 0)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hasFreeGiB returns true when statfs fails", () => {
    vi.spyOn(fs, "statfsSync").mockImplementation(() => {
      throw new Error("nope");
    });
    expect(hasFreeGiB("/nope", 100)).toBe(true);
  });
});
