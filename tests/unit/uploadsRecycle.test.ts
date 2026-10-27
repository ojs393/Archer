import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recycleUploads } from "../../server/boot/uploads.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-uploads-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function touch(name: string, mtimeMs: number): string {
  const full = path.join(dir, name);
  fs.writeFileSync(full, "csv");
  const when = new Date(mtimeMs);
  fs.utimesSync(full, when, when);
  return full;
}

describe("recycleUploads", () => {
  it("removes a leftover incoming file older than the TTL", () => {
    const now = new Date("2026-10-26T12:00:00.000Z");
    const ttl = 60_000;
    touch("incoming-old.csv", now.getTime() - ttl - 1);
    touch("incoming-fresh.csv", now.getTime() - 1_000);
    touch("12-abcdef.csv", now.getTime() - ttl - 1);

    expect(recycleUploads(dir, { maxAgeMs: ttl, now })).toBe(2);
    expect(fs.readdirSync(dir).sort()).toEqual(["incoming-fresh.csv"]);
  });

  it("removes stale .partial orphans past the TTL", () => {
    const now = new Date("2026-10-26T12:00:00.000Z");
    touch("archer-2026-10-01.db.partial", now.getTime() - 10);
    expect(recycleUploads(dir, { maxAgeMs: 5, now })).toBe(1);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("is a no-op on a missing directory", () => {
    expect(recycleUploads(dir + "-missing")).toBe(0);
  });
});
