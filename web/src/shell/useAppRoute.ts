import { useCallback, useEffect, useState } from "react";
import { canonicaliseAppHash, parseAppRoute, type AppRoute } from "@/lib/campaignRoute";
import { navigateToTab, type TabId } from "@/lib/tabs";

export type SelectTab = (tab: TabId, opts?: { replace?: boolean }) => void;

/** Active shell tab or campaign mini-app route, driven by `location.hash`. */
export function useAppRoute(): [AppRoute, SelectTab] {
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute(window.location.hash));

  useEffect(() => {
    const sync = () => setRoute(canonicaliseAppHash());
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const select = useCallback<SelectTab>((next, opts) => {
    navigateToTab(next, opts);
    setRoute({ kind: "tab", tab: next });
  }, []);

  return [route, select];
}

/** Shell tab highlight; `null` when no primary tab should look selected (e.g. not-found). */
export function shellTab(route: AppRoute): TabId | null {
  if (route.kind === "campaign") return "runs";
  if (route.kind === "notfound") return null;
  return route.tab;
}
