import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { refreshSession } from "./api";
import { EventStream, type StreamEventName, type StreamEvents, type StreamState } from "./eventStream";
import { queryKeys } from "./queryKeys";

const INVALIDATE_COALESCE_MS = 750;

export const eventStream = new EventStream({ url: "/api/events", beforeReconnect: refreshSession });

type QueryKeyName = keyof typeof queryKeys;

function syncQueries(stream: EventStream, client: QueryClient): () => void {
  const pending = new Set<QueryKeyName>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    for (const name of pending) void client.invalidateQueries({ queryKey: queryKeys[name] });
    pending.clear();
  };
  const invalidate = (...names: QueryKeyName[]) => {
    for (const name of names) pending.add(name);
    timer ??= setTimeout(flush, INVALIDATE_COALESCE_MS);
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
    stream.on("worker", () => invalidate("status", "campaigns", "analytics")),
    stream.on("import", (event) => {
      if (event.phase === "done" || event.phase === "failed") invalidate("lists");
    }),
  ];
  return () => {
    for (const off of offs) off();
    if (timer) clearTimeout(timer);
    timer = null;
    pending.clear();
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

/** Holds the shared `/api/events` connection open while mounted and keeps React Query in step with it. */
export function useEventStream(stream: EventStream = eventStream): StreamState {
  const client = useQueryClient();
  useEffect(() => {
    const unbind = bindQueryClient(stream, client);
    const release = stream.retain();
    return () => {
      release();
      unbind();
    };
  }, [stream, client]);
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
