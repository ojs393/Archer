import { useCallback, useEffect, useState } from "react";
import { canonicaliseTabHash, navigateToTab, parseTabHash, type TabId } from "@/lib/tabs";

export type SelectTab = (tab: TabId, opts?: { replace?: boolean }) => void;

/** The active tab, kept in `location.hash` (`#/runs`) so reload and back/forward work. */
export function useHashTab(): [TabId, SelectTab] {
  const [tab, setTab] = useState<TabId>(() => parseTabHash(window.location.hash));

  useEffect(() => {
    const sync = () => setTab(canonicaliseTabHash());
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
    setTab(next);
  }, []);

  return [tab, select];
}
