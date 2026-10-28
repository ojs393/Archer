import { canonicaliseTabHash, isTabId, parseTabHash, type TabId } from "@/lib/tabs";

export const CAMPAIGN_TABS = ["overview", "sends", "activity", "configure", "feedback"] as const;
export type CampaignTab = (typeof CAMPAIGN_TABS)[number];

export type AppRoute =
  | { kind: "tab"; tab: TabId }
  | { kind: "campaign"; id: number; tab: CampaignTab }
  | { kind: "chains" }
  | { kind: "notfound" };

export function isCampaignTab(value: string | undefined): value is CampaignTab {
  return value !== undefined && (CAMPAIGN_TABS as readonly string[]).includes(value);
}

function parsePositiveId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Parse `#/campaigns/:id/:tab` or shell tabs; `#/runs?id=n` is treated as a campaign route. */
export function parseAppRoute(hash: string): AppRoute {
  const stripped = hash.replace(/^#\/?/, "");
  const qIndex = stripped.indexOf("?");
  const path = qIndex >= 0 ? stripped.slice(0, qIndex) : stripped;
  const query = qIndex >= 0 ? stripped.slice(qIndex + 1) : "";
  const parts = path.split("/").filter(Boolean);

  if (parts[0]?.toLowerCase() === "chains") {
    return { kind: "chains" };
  }

  if (parts[0]?.toLowerCase() === "campaigns") {
    const id = parsePositiveId(parts[1]);
    if (id !== null) {
      const tab = isCampaignTab(parts[2]?.toLowerCase()) ? (parts[2].toLowerCase() as CampaignTab) : "overview";
      return { kind: "campaign", id, tab };
    }
  }

  if ((parts[0]?.toLowerCase() === "runs" || parts.length === 0) && query) {
    const id = parsePositiveId(new URLSearchParams(query).get("id") ?? undefined);
    if (id !== null) return { kind: "campaign", id, tab: "overview" };
  }

  const segment = (parts[0] ?? "").toLowerCase();
  if (!segment) return { kind: "tab", tab: parseTabHash(hash) };
  if (isTabId(segment)) return { kind: "tab", tab: segment };
  if (segment === "campaigns") return { kind: "notfound" };
  return { kind: "notfound" };
}

export function campaignHash(id: number, tab: CampaignTab = "overview"): string {
  return tab === "overview" ? `#/campaigns/${id}` : `#/campaigns/${id}/${tab}`;
}

export function navigateToCampaign(id: number, tab: CampaignTab = "overview"): void {
  const next = campaignHash(id, tab);
  if (window.location.hash === next) return;
  window.location.hash = next;
}

/** Rewrite legacy `#/runs?id=`, campaign tabs, and empty hash to canonical forms. */
export function canonicaliseAppHash(): AppRoute {
  const hash = window.location.hash;
  if (!hash || hash === "#" || hash === "#/") {
    return { kind: "tab", tab: canonicaliseTabHash() };
  }
  const route = parseAppRoute(hash);
  if (route.kind === "campaign") {
    const next = campaignHash(route.id, route.tab);
    if (hash !== next) {
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, "", `${pathname}${search}${next}`);
    }
    return route;
  }
  if (route.kind === "chains") {
    if (hash !== "#/chains") {
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, "", `${pathname}${search}#/chains`);
    }
    return route;
  }
  if (route.kind === "notfound") {
    const next = "#/not-found";
    if (hash !== next) {
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, "", `${pathname}${search}${next}`);
    }
    return route;
  }
  return { kind: "tab", tab: canonicaliseTabHash() };
}
