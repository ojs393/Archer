export interface MarkPlacement {
  /** Vertical shift (in 512-unit canvas space) that centres the mark at scale 1. */
  translateY?: number;
  /** Scale about the canvas centre. */
  scale?: number;
}

export function pngSize(png: Buffer): { width: number; height: number };

/** PNG-embedded ICO; every image must be 256 px or smaller. */
export function encodeIco(pngs: Buffer[]): Buffer;

/** PNG-embedded ICNS; `type` is the four-character OSType such as "ic07". */
export function encodeIcns(entries: { type: string; png: Buffer }[]): Buffer;

export function markGroup(markSvg: string): string;

/** The mark without the dome highlight and the brim stroke, for sizes where they muddy. */
export function simplifyMarkGroup(group: string): string;

export function appIconSvg(group: string, placement: MarkPlacement): string;

/** White square without rounded corners, for launchers that apply their own mask. */
export function fullBleedIconSvg(group: string, placement: MarkPlacement): string;

/** Full-bleed icon with the mark inside the central 60% (maskable safe zone). */
export function maskableIconSvg(group: string): string;

export const MASKABLE_SCALE: number;
export const MARK_OPTICAL_OFFSET_Y: number;
