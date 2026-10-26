import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { focusRing, focusRingInset } from "@/lib/utils";

const src = path.resolve(__dirname);

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.(tsx?|css)$/.test(e.name) && !e.name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("focus indicator (R65)", () => {
  it("uses blue-600 for the ring token", () => {
    const css = fs.readFileSync(path.join(src, "index.css"), "utf8");
    expect(css).toMatch(/--ring: 221\.2 83\.2% 53\.3%;/);
    expect(css).toMatch(/:focus-visible \{\s*outline: 2px solid hsl\(var\(--ring\)\);\s*outline-offset: 2px;/);
  });

  it("is a solid 2px ring with a 2px white offset, only on keyboard focus", () => {
    for (const cls of [focusRing, focusRingInset]) {
      const parts = cls.split(" ");
      for (const p of ["focus-visible:ring-2", "focus-visible:ring-ring", "focus-visible:ring-offset-2", "focus-visible:ring-offset-background"]) {
        expect(parts).toContain(p);
      }
      expect(parts.every((p) => p.startsWith("focus-visible:"))).toBe(true);
    }
  });

  it("has no translucent or off-brand focus rings left in the sources", () => {
    for (const file of sources(src)) {
      const text = fs.readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/ring-ring\/\d+/);
      expect(text, file).not.toMatch(/focus-visible:ring-destructive/);
      expect(text, file).not.toMatch(/focus-visible:ring-2 focus-visible:ring-ring\/|focus:ring-/);
    }
  });
});
