// Renders every icon from web/public/brand/mark.svg. Outputs are committed, so users never run this.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import {
  appIconSvg,
  encodeIcns,
  encodeIco,
  fullBleedIconSvg,
  MARK_OPTICAL_OFFSET_Y,
  markGroup,
  maskableIconSvg,
  simplifyMarkGroup,
} from "./lib/icons.mjs";
import { projectRoot } from "./lib/paths.mjs";

const APP_ICON_PLACEMENT = { translateY: 32, scale: 1 };
const SMALL_ICON_PLACEMENT = { translateY: MARK_OPTICAL_OFFSET_Y, scale: 1.15 };
const TOUCH_ICON_PLACEMENT = { translateY: MARK_OPTICAL_OFFSET_Y, scale: 0.9 };
const SMALL_MAX_PX = 48;

const root = projectRoot();
const publicDir = path.join(root, "web", "public");
const assetsDir = path.join(root, "assets", "icons");

const require = createRequire(import.meta.url);
await initWasm(fs.readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));

const mark = markGroup(fs.readFileSync(path.join(publicDir, "brand", "mark.svg"), "utf8"));
const appIcon = appIconSvg(mark, APP_ICON_PLACEMENT);
const smallIcon = appIconSvg(simplifyMarkGroup(mark), SMALL_ICON_PLACEMENT);
const maskableIcon = maskableIconSvg(mark);
const touchIcon = fullBleedIconSvg(mark, TOUCH_ICON_PLACEMENT, { dark: true });
const PLATE = "#0A1218";

/** Rounded icons keep transparent corners; full-bleed dark tiles get an opaque plate behind. */
function render(svg, size, { opaque = false, background = PLATE } = {}) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size }, ...(opaque ? { background } : {}) });
  const image = resvg.render();
  const png = Buffer.from(image.asPng());
  image.free();
  resvg.free();
  return png;
}

const cache = new Map();
function appPng(size) {
  if (!cache.has(size)) cache.set(size, render(size <= SMALL_MAX_PX ? smallIcon : appIcon, size));
  return cache.get(size);
}

const manifest = {
  name: "Archer",
  short_name: "Archer",
  start_url: "/",
  display: "standalone",
  theme_color: "#0A1218",
  background_color: "#0A1218",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

const outputs = [
  [path.join(publicDir, "brand", "app-icon.svg"), appIcon],
  [path.join(publicDir, "favicon.svg"), appIcon],
  [path.join(publicDir, "favicon-16.png"), appPng(16)],
  [path.join(publicDir, "favicon-32.png"), appPng(32)],
  [path.join(publicDir, "favicon-48.png"), appPng(48)],
  [path.join(publicDir, "apple-touch-icon.png"), render(touchIcon, 180, { opaque: true })],
  [path.join(publicDir, "icon-192.png"), appPng(192)],
  [path.join(publicDir, "icon-512.png"), appPng(512)],
  [path.join(publicDir, "icon-maskable-512.png"), render(maskableIcon, 512, { opaque: true })],
  [path.join(publicDir, "favicon.ico"), encodeIco([16, 32, 48].map(appPng))],
  [path.join(publicDir, "site.webmanifest"), `${JSON.stringify(manifest, null, 2)}\n`],
  [path.join(assetsDir, "archer.ico"), encodeIco([16, 24, 32, 48, 64, 128, 256].map(appPng))],
  [
    path.join(assetsDir, "archer.icns"),
    encodeIcns(
      [
        ["ic07", 128],
        ["ic08", 256],
        ["ic09", 512],
        ["ic10", 1024],
        ["ic11", 32],
        ["ic12", 64],
        ["ic13", 256],
        ["ic14", 512],
      ].map(([type, size]) => ({ type, png: appPng(size) })),
    ),
  ],
  [path.join(assetsDir, "archer-512.png"), appPng(512)],
  [path.join(assetsDir, "archer-1024.png"), appPng(1024)],
];

let written = 0;
for (const [file, content] of outputs) {
  const data = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  if (fs.existsSync(file) && fs.readFileSync(file).equals(data)) continue;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  written++;
  console.log(`wrote ${path.relative(root, file)}`);
}
console.log(written === 0 ? "icons up to date" : `${written} icon file(s) written`);
