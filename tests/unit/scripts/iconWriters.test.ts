import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectRoot } from "../../../scripts/lib/paths.mjs";
import {
  appIconSvg,
  encodeIcns,
  encodeIco,
  markGroup,
  maskableIconSvg,
  pngSize,
  simplifyMarkGroup,
} from "../../../scripts/lib/icons.mjs";

function fakePng(width: number, height: number, extra = 0): Buffer {
  const buf = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <g>
    <path d="M1 1 Z" fill="#3f3f46"/>
    <path d="M2 2 Z" fill="#52525b"/>
    <path d="M3 3" fill="none" stroke="#71717a" stroke-width="4" stroke-linecap="round"/>
  </g>
</svg>`;

describe("pngSize", () => {
  it("reads width and height from IHDR", () => {
    expect(pngSize(fakePng(180, 64))).toEqual({ width: 180, height: 64 });
  });

  it("rejects data that is not a PNG", () => {
    expect(() => pngSize(Buffer.from("GIF89a-not-a-png-at-all-really-not"))).toThrow(/PNG/);
  });
});

describe("encodeIco", () => {
  it("writes a header, one directory entry per image and the PNG payloads", () => {
    const a = fakePng(16, 16, 4);
    const b = fakePng(256, 256, 10);
    const ico = encodeIco([a, b]);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);

    const first = 6;
    expect(ico[first]).toBe(16);
    expect(ico[first + 1]).toBe(16);
    expect(ico.readUInt16LE(first + 4)).toBe(1);
    expect(ico.readUInt16LE(first + 6)).toBe(32);
    expect(ico.readUInt32LE(first + 8)).toBe(a.length);
    expect(ico.readUInt32LE(first + 12)).toBe(6 + 2 * 16);

    const second = first + 16;
    expect(ico[second]).toBe(0);
    expect(ico[second + 1]).toBe(0);
    expect(ico.readUInt32LE(second + 8)).toBe(b.length);
    const offset = ico.readUInt32LE(second + 12);
    expect(offset).toBe(6 + 2 * 16 + a.length);
    expect(ico.subarray(offset, offset + b.length).equals(b)).toBe(true);
    expect(ico.length).toBe(6 + 32 + a.length + b.length);
  });

  it("refuses images larger than 256 px", () => {
    expect(() => encodeIco([fakePng(512, 512)])).toThrow(/256/);
  });
});

describe("encodeIcns", () => {
  it("writes the icns header and typed PNG entries", () => {
    const a = fakePng(128, 128, 3);
    const b = fakePng(32, 32, 1);
    const icns = encodeIcns([
      { type: "ic07", png: a },
      { type: "ic11", png: b },
    ]);
    expect(icns.toString("ascii", 0, 4)).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    expect(icns.toString("ascii", 8, 12)).toBe("ic07");
    expect(icns.readUInt32BE(12)).toBe(8 + a.length);
    expect(icns.subarray(16, 16 + a.length).equals(a)).toBe(true);
    const next = 16 + a.length;
    expect(icns.toString("ascii", next, next + 4)).toBe("ic11");
    expect(icns.readUInt32BE(next + 4)).toBe(8 + b.length);
    expect(icns.length).toBe(8 + 16 + a.length + b.length);
  });

  it("refuses an entry type that is not four characters", () => {
    expect(() => encodeIcns([{ type: "ic1", png: fakePng(1, 1) }])).toThrow(/type/);
  });
});

describe("mark svg helpers", () => {
  it("extracts the mark group", () => {
    const g = markGroup(MARK);
    expect(g.startsWith("<g>")).toBe(true);
    expect(g.endsWith("</g>")).toBe(true);
    expect(g).toContain('fill="#3f3f46"');
  });

  describe("simplifyMarkGroup on the real v2 mark", () => {
    const full = markGroup(fs.readFileSync(path.join(projectRoot(), "web", "public", "brand", "mark.svg"), "utf8"));
    const simple = simplifyMarkGroup(full);
    const ds = (g: string) => [...g.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
    const fullDs = ds(full);

    it("keeps fewer paths than the full mark", () => {
      expect(fullDs).toHaveLength(14);
      expect(ds(simple).length).toBeLessThan(fullDs.length);
    });

    it("keeps feathers 1 and 3 of each wing, both shoulders, the dome and the brim", () => {
      const kept = new Set(ds(simple));
      const [l1, l2, l3, l4, lShoulder, r1, r2, r3, r4, rShoulder, dome, highlight, band, brim] = fullDs;
      for (const d of [l1, l3, lShoulder, r1, r3, rShoulder, dome, brim]) expect(kept.has(d), d).toBe(true);
      for (const d of [l2, l4, r2, r4, highlight, band]) expect(kept.has(d), d).toBe(false);
      expect(kept.size).toBe(8);
    });

    it("thickens each wing's feathers by scaling 1.08 from the wing base", () => {
      const scaled = [...simple.matchAll(/<g transform="translate\(([\d.]+) ([\d.]+)\) scale\(1\.08\) translate\(-([\d.]+) -([\d.]+)\)">/g)];
      expect(scaled).toHaveLength(2);
      const [left, right] = scaled.map((m) => Number(m[1]));
      expect(left).toBeLessThan(256);
      expect(right).toBeGreaterThan(256);
    });

    it("paints feathers under the shoulder, dome and brim", () => {
      const order = ds(simple);
      expect(order.indexOf(fullDs[0])).toBeLessThan(order.indexOf(fullDs[4]));
      expect(order.at(-2)).toBe(fullDs[10]);
      expect(order.at(-1)).toBe(fullDs[13]);
      expect(simple.startsWith("<g>")).toBe(true);
    });

    it("ignores colours: recoloured paths simplify the same way", () => {
      const recoloured = full.replace(/fill="#[0-9a-f]{6}"/g, 'fill="#123456"');
      expect(ds(simplifyMarkGroup(recoloured))).toEqual(ds(simple));
    });
  });

  it("wraps the mark in a white rounded square with a hairline for the app icon", () => {
    const svg = appIconSvg(markGroup(MARK), { translateY: 24, scale: 1 });
    expect(svg).toContain('<rect width="512" height="512" rx="112" fill="#ffffff"/>');
    expect(svg).toContain('<rect x="6" y="6" width="500" height="500" rx="106" fill="none" stroke="#e4e4e7" stroke-width="4"/>');
    expect(svg).toContain('transform="translate(0 24)"');
  });

  it("scales the mark about the canvas centre when asked", () => {
    const svg = appIconSvg(markGroup(MARK), { translateY: 19, scale: 1.2 });
    expect(svg).toContain('transform="translate(256 256) scale(1.2) translate(-256 -237)"');
  });

  it("puts the maskable mark on a full-bleed white square", () => {
    const svg = maskableIconSvg(markGroup(MARK));
    expect(svg).toContain('<rect width="512" height="512" fill="#ffffff"/>');
    expect(svg).not.toContain("rx=");
    expect(svg).toMatch(/scale\(0\.\d+\)/);
  });
});
