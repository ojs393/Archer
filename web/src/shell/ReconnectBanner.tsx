import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useEventStreamState } from "@/lib/useEventStream";

export const RECONNECT_BANNER_DELAY_MS = 3_000;

/** Thin notice once the live connection (held by the shell) has been down for more than a few seconds. */
export function ReconnectBanner() {
  const { connected, downSince } = useEventStreamState();
  const [, rerender] = useState(0);
  const downFor = !connected && downSince !== null ? Date.now() - downSince : 0;
  const visible = !connected && downSince !== null && downFor > RECONNECT_BANNER_DELAY_MS;

  useEffect(() => {
    if (connected || downSince === null || visible) return;
    const timer = setTimeout(() => rerender((n) => n + 1), RECONNECT_BANNER_DELAY_MS - downFor + 50);
    return () => clearTimeout(timer);
  }, [connected, downSince, visible, downFor]);

  if (!visible) return null;
  return (
    <div role="status" className="flex h-8 items-center justify-center gap-2 bg-zinc-900 px-4 text-xs font-medium text-white">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      Reconnecting
    </div>
  );
}
