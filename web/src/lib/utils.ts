import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Keyboard focus ring: solid 2px blue-600 outside a 2px white gap.
 * Only while `html[data-modality=keyboard]` (see `installFocusModality`) so click/autofocus stays clean.
 */
const keyboardFocus = "[:is(html[data-modality=keyboard])_&]:focus-visible";

export const focusRing = [
  "outline-none focus-visible:outline-none",
  `${keyboardFocus}:ring-2`,
  `${keyboardFocus}:ring-ring`,
  `${keyboardFocus}:ring-offset-2`,
  `${keyboardFocus}:ring-offset-background`,
].join(" ");

/** Same ring drawn inside the element, for controls whose container clips overflow (the header tabs). */
export const focusRingInset = [
  "outline-none focus-visible:outline-none",
  `${keyboardFocus}:ring-2`,
  `${keyboardFocus}:ring-inset`,
  `${keyboardFocus}:ring-ring`,
  `${keyboardFocus}:ring-offset-2`,
  `${keyboardFocus}:ring-offset-background`,
].join(" ");
