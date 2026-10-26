const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CANVAS = 512;
const CENTER = CANVAS / 2;

export function pngSize(png) {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Not a PNG image");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const png of pngs) {
    const { width, height } = pngSize(png);
    if (width > 256 || height > 256) throw new Error(`ICO images must be 256 px or smaller (got ${width}x${height})`);
    const entry = Buffer.alloc(16);
    entry[0] = width === 256 ? 0 : width;
    entry[1] = height === 256 ? 0 : height;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...pngs]);
}

export function encodeIcns(entries) {
  const chunks = entries.map(({ type, png }) => {
    if (typeof type !== "string" || !/^[\x20-\x7e]{4}$/.test(type)) throw new Error(`Invalid icns type ${JSON.stringify(type)}`);
    pngSize(png);
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

export function markGroup(markSvg) {
  const match = /<g>[\s\S]*<\/g>/.exec(markSvg);
  if (!match) throw new Error("mark.svg has no <g> group");
  return match[0];
}

const FEATHER_THICKEN = 1.08;

function pathBox(d) {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function parsePaths(group) {
  return [...group.matchAll(/<path\b[^>]*\/>/g)].map(([el]) => {
    const d = /\sd="([^"]+)"/.exec(el);
    if (!d) throw new Error(`mark path without d: ${el}`);
    return { el, box: pathBox(d[1]) };
  });
}

/**
 * Small-size mark, chosen by geometry (not colour): drops the details inside the dome (highlight, band)
 * and every other feather, and thickens the kept feathers about each wing's base.
 */
export function simplifyMarkGroup(group) {
  const paths = parsePaths(group);
  const spansCentre = (p) => p.box.minX < CENTER && p.box.maxX > CENTER;
  const central = paths.filter(spansCentre);
  if (central.length === 0) throw new Error("mark has no shape across the centre");
  const height = (p) => p.box.maxY - p.box.minY;
  const dome = central.reduce((a, b) => (height(b) > height(a) ? b : a));
  const insideDome = (p) =>
    p !== dome && p.box.minX >= dome.box.minX && p.box.maxX <= dome.box.maxX && p.box.minY >= dome.box.minY && p.box.maxY <= dome.box.maxY;
  const brims = central.filter((p) => p !== dome && !insideDome(p));

  const wing = (left) => {
    const shapes = paths.filter((p) => !spansCentre(p) && !insideDome(p) && (left ? p.box.maxX <= CENTER : p.box.minX >= CENTER));
    if (shapes.length === 0) return [];
    const width = (p) => p.box.maxX - p.box.minX;
    const shoulder = shapes.reduce((a, b) => (width(b) < width(a) ? b : a));
    const feathers = shapes.filter((p) => p !== shoulder).sort((a, b) => a.box.minY - b.box.minY);
    const kept = feathers.filter((_, i) => i % 2 === 0);
    const baseX = left ? Math.max(...kept.map((p) => p.box.maxX)) : Math.min(...kept.map((p) => p.box.minX));
    const baseY = Math.max(...kept.map((p) => p.box.maxY));
    return [
      `    <g transform="translate(${baseX} ${baseY}) scale(${FEATHER_THICKEN}) translate(-${baseX} -${baseY})">`,
      ...kept.map((p) => `      ${p.el}`),
      `    </g>`,
      `    ${shoulder.el}`,
    ];
  };

  return ["<g>", ...wing(true), ...wing(false), `    ${dome.el}`, ...brims.map((p) => `    ${p.el}`), "  </g>"].join("\n");
}

function placed(group, { translateY = 0, scale = 1 }) {
  const transform =
    scale === 1
      ? `translate(0 ${translateY})`
      : `translate(${CENTER} ${CENTER}) scale(${scale}) translate(-${CENTER} -${CENTER - translateY})`;
  return group.replace(/^<g>/, `<g transform="${transform}">`);
}

function svgDocument(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" role="img" aria-label="MamaDirect">\n${body}\n</svg>\n`;
}

export function appIconSvg(group, placement) {
  return svgDocument(
    [
      `  <rect width="512" height="512" rx="112" fill="#ffffff"/>`,
      `  <rect x="6" y="6" width="500" height="500" rx="106" fill="none" stroke="#e4e4e7" stroke-width="4"/>`,
      `  ${placed(group, placement)}`,
    ].join("\n"),
  );
}

export const MASKABLE_SCALE = 0.85;
export const MARK_OPTICAL_OFFSET_Y = 34;

export function fullBleedIconSvg(group, placement) {
  return svgDocument([`  <rect width="512" height="512" fill="#ffffff"/>`, `  ${placed(group, placement)}`].join("\n"));
}

export function maskableIconSvg(group) {
  return fullBleedIconSvg(group, { translateY: MARK_OPTICAL_OFFSET_Y, scale: MASKABLE_SCALE });
}
