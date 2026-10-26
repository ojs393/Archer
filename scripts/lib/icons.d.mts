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

/**
 * Small-size mark chosen by geometry: drops the shapes inside the dome (highlight, band) and every other
 * feather, keeps shoulders, dome and brim, and scales each wing's kept feathers 1.08 from its base.
 */
export function simplifyMarkGroup(group: string): string;

export function appIconSvg(group: string, placement: MarkPlacement): string;

/** White square without rounded corners, for launchers that apply their own mask. */
export function fullBleedIconSvg(group: string, placement: MarkPlacement): string;

/** Full-bleed icon with the mark inside the 80% maskable safe-zone circle. */
export function maskableIconSvg(group: string): string;

export const MASKABLE_SCALE: number;
export const MARK_OPTICAL_OFFSET_Y: number;
