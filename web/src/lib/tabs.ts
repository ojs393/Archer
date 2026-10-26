export const TAB_IDS = ["dashboard", "runs", "audience", "templates", "settings"] as const;

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

export function navigateToTab(tab: TabId): void {
  const hash = tabHash(tab);
  if (window.location.hash !== hash) window.location.hash = hash;
}
