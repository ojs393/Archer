/** Dispatched when Dashboard (or anything else) wants the new-run wizard open. */
export const NEW_RUN_EVENT = "mamadirect:new-run";

export function requestNewRun(): void {
  window.dispatchEvent(new Event(NEW_RUN_EVENT));
}
