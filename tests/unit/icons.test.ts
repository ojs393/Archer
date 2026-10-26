import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectRoot } from "../../scripts/lib/paths.mjs";

const root = projectRoot();
const pub = (...p: string[]) => path.join(root, "web", "public", ...p);
const asset = (name: string) => path.join(root, "assets", "icons", name);

function pngDims(buf: Buffer): [number, number] {
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(buf.toString("ascii", 12, 16)).toBe("IHDR");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

function icoSizes(buf: Buffer): number[] {
  expect(buf.readUInt16LE(0)).toBe(0);
  expect(buf.readUInt16LE(2)).toBe(1);
  const count = buf.readUInt16LE(4);
  const sizes: number[] = [];
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const length = buf.readUInt32LE(entry + 8);
    const offset = buf.readUInt32LE(entry + 12);
    expect(offset + length).toBeLessThanOrEqual(buf.length);
    const [w, h] = pngDims(buf.subarray(offset, offset + length));
    expect(buf[entry] || 256).toBe(w);
    expect(buf[entry + 1] || 256).toBe(h);
    sizes.push(w);
  }
  return sizes;
}

function icnsEntries(buf: Buffer): Record<string, number> {
  expect(buf.toString("ascii", 0, 4)).toBe("icns");
  expect(buf.readUInt32BE(4)).toBe(buf.length);
  const entries: Record<string, number> = {};
  let at = 8;
  while (at < buf.length) {
    const type = buf.toString("ascii", at, at + 4);
    const length = buf.readUInt32BE(at + 4);
    expect(length).toBeGreaterThan(8);
    const [w, h] = pngDims(buf.subarray(at + 8, at + length));
    expect(w).toBe(h);
    entries[type] = w;
    at += length;
  }
  expect(at).toBe(buf.length);
  return entries;
}

describe("committed icon set", () => {
  it.each([
    ["favicon-16.png", 16],
    ["favicon-32.png", 32],
    ["favicon-48.png", 48],
    ["apple-touch-icon.png", 180],
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["icon-maskable-512.png", 512],
  ])("web/public/%s is %i px square", (name, size) => {
    expect(pngDims(fs.readFileSync(pub(name)))).toEqual([size, size]);
  });

  it.each([
    ["mamadirect-512.png", 512],
    ["mamadirect-1024.png", 1024],
  ])("assets/icons/%s is %i px square", (name, size) => {
    expect(pngDims(fs.readFileSync(asset(name)))).toEqual([size, size]);
  });

  it("favicon.ico embeds 16, 32 and 48 px PNGs", () => {
    expect(icoSizes(fs.readFileSync(pub("favicon.ico")))).toEqual([16, 32, 48]);
  });

  it("mamadirect.ico embeds 16 to 256 px PNGs", () => {
    expect(icoSizes(fs.readFileSync(asset("mamadirect.ico")))).toEqual([16, 24, 32, 48, 64, 128, 256]);
  });

  it("mamadirect.icns has every retina and standard entry", () => {
    expect(icnsEntries(fs.readFileSync(asset("mamadirect.icns")))).toEqual({
      ic07: 128,
      ic08: 256,
      ic09: 512,
      ic10: 1024,
      ic11: 32,
      ic12: 64,
      ic13: 256,
      ic14: 512,
    });
  });

  it("favicon.svg is the app icon, which wraps the exact mark paths", () => {
    const mark = fs.readFileSync(pub("brand", "mark.svg"), "utf8");
    const appIcon = fs.readFileSync(pub("brand", "app-icon.svg"), "utf8");
    expect(fs.readFileSync(pub("favicon.svg"), "utf8")).toBe(appIcon);
    expect(appIcon).toContain('<rect width="512" height="512" rx="112" fill="#ffffff"/>');
    for (const d of mark.match(/d="[^"]+"/g) ?? []) expect(appIcon).toContain(d);
    expect(mark.match(/<path /g)).toHaveLength(10);
  });

  it("site.webmanifest lists the 192, 512 and maskable icons on white", () => {
    const manifest = JSON.parse(fs.readFileSync(pub("site.webmanifest"), "utf8"));
    expect(manifest).toMatchObject({
      name: "MamaDirect",
      short_name: "MamaDirect",
      display: "standalone",
      theme_color: "#ffffff",
      background_color: "#ffffff",
    });
    expect(manifest.icons.map((i: { src: string }) => i.src)).toEqual([
      "/icon-192.png",
      "/icon-512.png",
      "/icon-maskable-512.png",
    ]);
    for (const icon of manifest.icons) expect(fs.existsSync(pub(icon.src.slice(1)))).toBe(true);
  });
});
