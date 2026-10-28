/** Last input modality — focus rings only render for keyboard (see `focusRing`). */
export type FocusModality = "pointer" | "keyboard";

const KEYBOARD_KEYS = new Set([
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  " ",
  "Escape",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export function getFocusModality(doc: Document = document): FocusModality {
  return doc.documentElement.dataset.modality === "keyboard" ? "keyboard" : "pointer";
}

export function setFocusModality(modality: FocusModality, doc: Document = document): void {
  if (doc.documentElement.dataset.modality !== modality) {
    doc.documentElement.dataset.modality = modality;
  }
}

/** Track pointer vs keyboard so focus rings do not show on click / autofocus. */
export function installFocusModality(doc: Document = document): () => void {
  setFocusModality("pointer", doc);

  const onPointerDown = () => setFocusModality("pointer", doc);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (KEYBOARD_KEYS.has(event.key)) setFocusModality("keyboard", doc);
  };

  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("keydown", onKeyDown, true);
  return () => {
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("keydown", onKeyDown, true);
  };
}
