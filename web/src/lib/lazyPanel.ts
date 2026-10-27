import { lazy, type ComponentType } from "react";

const RELOAD_KEY = "archer:chunk-reload-at";
const RELOAD_COOLDOWN_MS = 30_000;

/** A code-split chunk could not be loaded even after reloading the page. */
export class StaleBuildError extends Error {
  constructor(cause: unknown) {
    super("This page is out of date. Reload to get the latest version.", { cause });
    this.name = "StaleBuildError";
  }
}

type Module = { default: ComponentType };

function readStamp(): number {
  try {
    return Number(window.sessionStorage.getItem(RELOAD_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeStamp(at: number): void {
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(at));
  } catch {
    // Storage unavailable: worst case the page reloads once more.
  }
}

/** Loads a chunk; if it is gone (the app was rebuilt while open), reloads the page once to pick up the new build. */
export async function loadOrReload<M extends Module>(
  load: () => Promise<M>,
  { reload = () => window.location.reload(), now = Date.now }: { reload?: () => void; now?: () => number } = {},
): Promise<M> {
  try {
    return await load();
  } catch (err) {
    const at = now();
    const last = readStamp();
    if (last && at - last < RELOAD_COOLDOWN_MS) throw new StaleBuildError(err);
    writeStamp(at);
    reload();
    return new Promise<M>(() => {});
  }
}

export function lazyPanel(load: () => Promise<Module>) {
  return lazy(() => loadOrReload(load));
}
