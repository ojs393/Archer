/** Parse `#/runs?id=<n>` from the location hash. Campaign ids are numeric. */
export function parseRunIdFromHash(hash = window.location.hash): number | null {
  const qIndex = hash.indexOf("?");
  if (qIndex < 0) return null;
  const id = new URLSearchParams(hash.slice(qIndex + 1)).get("id");
  if (!id) return null;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function setRunIdInHash(id: number | null): void {
  const next = id === null ? "#/runs" : `#/runs?id=${id}`;
  if (window.location.hash === next) return;
  window.location.hash = next;
}
