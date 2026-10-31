export const TAB_IDS = ["dashboard", "runs", "audience", "templates", "chains", "settings"] as const;

export type TabId = (typeof TAB_IDS)[number];

export const DEFAULT_TAB: TabId = "dashboard";

export function isTabId(value: string): value is TabId {
  return (TAB_IDS as readonly string[]).includes(value);
}

export function parseTabHash(hash: string): TabId {
  const segment = hash.replace(/^#\/?/, "").split(/[/?]/, 1)[0].toLowerCase();
  return isTabId(segment) ? segment : DEFAULT_TAB;
}

export function tabHash(tab: TabId): string {
  return `#/${tab}`;
}

function replaceHash(hash: string): void {
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname}${search}${hash}`);
}

/** `replace` rewrites the current history entry (keyboard roving) instead of pushing one. */
export function navigateToTab(tab: TabId, { replace = false }: { replace?: boolean } = {}): void {
  const hash = tabHash(tab);
  if (window.location.hash === hash) return;
  if (replace) replaceHash(hash);
  else window.location.hash = hash;
}

/** Rewrites a missing, unknown or non-canonical hash in place and returns the tab it names. */
export function canonicaliseTabHash(): TabId {
  const tab = parseTabHash(window.location.hash);
  if (window.location.hash !== tabHash(tab)) replaceHash(tabHash(tab));
  return tab;
}
