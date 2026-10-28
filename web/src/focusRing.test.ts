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

const keyboardScope = "[:is(html[data-modality=keyboard])_&]:focus-visible";

describe("focus indicator (R65)", () => {
  it("uses blue-600 for the ring token and gates the global outline to keyboard modality", () => {
    const css = fs.readFileSync(path.join(src, "index.css"), "utf8");
    expect(css).toMatch(/--ring: 221\.2 83\.2% 53\.3%;/);
    expect(css).toMatch(/html\[data-modality="keyboard"\] :focus-visible/);
    expect(css).toMatch(/html\[data-modality="pointer"\] :focus-visible \{\s*outline:\s*none;/);
  });

  it("is a solid 2px ring with a 2px white offset, only for keyboard modality", () => {
    for (const cls of [focusRing, focusRingInset]) {
      expect(cls).toContain("focus-visible:outline-none");
      for (const p of [
        `${keyboardScope}:ring-2`,
        `${keyboardScope}:ring-ring`,
        `${keyboardScope}:ring-offset-2`,
        `${keyboardScope}:ring-offset-background`,
      ]) {
        expect(cls).toContain(p);
      }
      expect(cls).not.toMatch(/(?:^|\s)focus-visible:ring-/);
      expect(cls).not.toMatch(/(?:^|\s)focus:ring-/);
    }
    expect(focusRingInset).toContain(`${keyboardScope}:ring-inset`);
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
