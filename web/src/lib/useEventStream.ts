import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { refreshSession } from "./api";
import { EventStream, type StreamEventName, type StreamEvents, type StreamState } from "./eventStream";
import { queryKeys } from "./queryKeys";

const INVALIDATE_COALESCE_MS = 750;

export const eventStream = new EventStream({ url: "/api/events", beforeReconnect: refreshSession });

type QueryKeyName = keyof typeof queryKeys;

/** Analytics queries are heavier, so they refetch at most this often however many events arrive. */
const MIN_INVALIDATE_INTERVAL_MS: Partial<Record<QueryKeyName, number>> = { analytics: 5_000 };

function syncQueries(stream: EventStream, client: QueryClient): () => void {
  const timers = new Map<QueryKeyName, ReturnType<typeof setTimeout>>();
  const lastRun = new Map<QueryKeyName, number>();
  const invalidate = (...names: QueryKeyName[]) => {
    for (const name of names) {
      if (timers.has(name)) continue;
      const earliest = (lastRun.get(name) ?? -Infinity) + (MIN_INVALIDATE_INTERVAL_MS[name] ?? 0);
      const wait = Math.max(INVALIDATE_COALESCE_MS, earliest - Date.now());
      timers.set(
        name,
        setTimeout(() => {
          timers.delete(name);
          lastRun.set(name, Date.now());
          void client.invalidateQueries({ queryKey: queryKeys[name] });
        }, wait),
      );
    }
  };

  let everConnected = stream.getState().connected;
  let missedEvents = false;
  const offState = stream.subscribeState(() => {
    if (!stream.getState().connected) {
      missedEvents = everConnected;
      return;
    }
    if (missedEvents) invalidate("status", "campaigns", "analytics", "lists");
    everConnected = true;
    missedEvents = false;
  });
  const offs = [
    offState,
    stream.on("status", (snapshot) => {
      client.setQueryData(queryKeys.status, snapshot);
      invalidate("campaigns", "analytics");
    }),
    stream.on("health", (health) => client.setQueryData(queryKeys.health, health)),
    stream.on("worker", () => invalidate("status", "campaigns")),
    stream.on("import", (event) => {
      if (event.phase === "done" || event.phase === "failed") invalidate("lists");
    }),
  ];
  return () => {
    for (const off of offs) off();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}

const bindings = new WeakMap<EventStream, Map<QueryClient, { holders: number; dispose: () => void }>>();

function bindQueryClient(stream: EventStream, client: QueryClient): () => void {
  let byClient = bindings.get(stream);
  if (!byClient) bindings.set(stream, (byClient = new Map()));
  let binding = byClient.get(client);
  if (!binding) byClient.set(client, (binding = { holders: 0, dispose: syncQueries(stream, client) }));
  binding.holders++;
  const bound = binding;
  return () => {
    if (--bound.holders > 0) return;
    bound.dispose();
    byClient.delete(client);
  };
}

/**
 * Holds the shared `/api/events` connection open while mounted (and `enabled`) and keeps React Query in
 * step with it. Mount it once near the root; components that only display the state use `useEventStreamState`.
 */
export function useEventStream({ enabled = true, stream = eventStream }: { enabled?: boolean; stream?: EventStream } = {}): StreamState {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const unbind = bindQueryClient(stream, client);
    const release = stream.retain();
    return () => {
      release();
      unbind();
    };
  }, [enabled, stream, client]);
  return useEventStreamState(stream);
}

/** The shared stream's state, without opening or holding the connection. */
export function useEventStreamState(stream: EventStream = eventStream): StreamState {
  return useSyncExternalStore(stream.subscribeState, stream.getState);
}

/** Calls `handler` for every `name` event while mounted; the latest handler is always used. */
export function useStreamEvent<K extends StreamEventName>(
  name: K,
  handler: (data: StreamEvents[K]) => void,
  stream: EventStream = eventStream,
): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const off = stream.on(name, (data) => latest.current(data));
    const release = stream.retain();
    return () => {
      release();
      off();
    };
  }, [name, stream]);
}
