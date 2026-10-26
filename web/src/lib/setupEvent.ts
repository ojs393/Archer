/** Dispatched when Settings (or anything else) wants the first-run wizard open. */
export const SETUP_EVENT = "mamadirect:setup";

export function requestSetupWizard(): void {
  window.dispatchEvent(new Event(SETUP_EVENT));
}
