import { useCallback, useEffect, useState } from "react";
import { navigateToTab, parseTabHash, tabHash, type TabId } from "@/lib/tabs";

/** The active tab, kept in `location.hash` (`#/runs`) so reload and back/forward work. */
export function useHashTab(): [TabId, (tab: TabId) => void] {
  const [tab, setTab] = useState<TabId>(() => parseTabHash(window.location.hash));

  useEffect(() => {
    const sync = () => setTab(parseTabHash(window.location.hash));
    const canonical = tabHash(parseTabHash(window.location.hash));
    if (window.location.hash !== canonical) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${canonical}`);
    }
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const select = useCallback((next: TabId) => {
    navigateToTab(next);
    setTab(next);
  }, []);

  return [tab, select];
}
