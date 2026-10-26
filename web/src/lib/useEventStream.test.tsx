import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelay, EventStream, type EventSourceLike } from "./eventStream";
import type { Health, StatusSnapshot } from "./types";

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  private handlers = new Map<string, ((ev: MessageEvent) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, fn: (ev: MessageEvent) => void): void {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  fail(): void {
    this.onerror?.(new Event("error"));
  }

  emit(name: string, data: unknown): void {
    for (const fn of this.handlers.get(name) ?? []) fn(new MessageEvent(name, { data: JSON.stringify(data) }));
  }
}

const latest = () => FakeEventSource.instances[FakeEventSource.instances.length - 1];
const snapshot: StatusSnapshot = {
  campaign: null,
  worker: { status: null, heartbeatAgeMs: null, loopRunning: false, inFlight: false },
};
const item = { status: "ok" as const, detail: "fine", checkedAt: null };
const health: Health = { smtp: item, dns: item, network: item, worker: { ...item, heartbeatAgeMs: 1, loopRunning: true } };

function makeStream(extra: Partial<ConstructorParameters<typeof EventStream>[0]> = {}) {
  return new EventStream({
    url: "/api/events",
    createSource: (url) => new FakeEventSource(url),
    random: () => 1,
    ...extra,
  });
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("backoffDelay", () => {
  it("doubles from 1 s to a 30 s cap with jitter in the upper half", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map((a) => backoffDelay(a, () => 1))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
    expect(backoffDelay(0, () => 0)).toBe(500);
    expect(backoffDelay(5, () => 0)).toBe(15000);
  });
});

describe("EventStream", () => {
  it("opens one connection for many holders and closes after the last release", async () => {
    const stream = makeStream();
    const a = stream.retain();
    const b = stream.retain();
    expect(FakeEventSource.instances).toHaveLength(1);
    a();
    await vi.advanceTimersByTimeAsync(5000);
    expect(latest().closed).toBe(false);
    b();
    await vi.advanceTimersByTimeAsync(5000);
    expect(latest().closed).toBe(true);
    expect(stream.getState().connected).toBe(false);
  });

  it("keeps the connection when a holder re-subscribes right away", async () => {
    const stream = makeStream();
    stream.retain()();
    stream.retain();
    await vi.advanceTimersByTimeAsync(5000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(latest().closed).toBe(false);
  });

  it("reconnects with exponential backoff and resets it after a successful open", async () => {
    const beforeReconnect = vi.fn(async () => {});
    const stream = makeStream({ beforeReconnect });
    stream.retain();
    latest().fail();
    expect(latest().closed).toBe(true);

    await vi.advanceTimersByTimeAsync(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(beforeReconnect).toHaveBeenCalledTimes(1);

    latest().fail();
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeEventSource.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(3);

    latest().open();
    expect(stream.getState().connected).toBe(true);
    latest().fail();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it("backs off again when the pre-reconnect step fails", async () => {
    const beforeReconnect = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(undefined);
    const stream = makeStream({ beforeReconnect });
    stream.retain();
    latest().fail();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("tracks connection state, the latest status and health, and when it went down", async () => {
    let now = 1_000;
    const stream = makeStream({ now: () => now });
    stream.retain();
    expect(stream.getState()).toMatchObject({ connected: false, downSince: 1_000 });
    latest().open();
    latest().emit("status", snapshot);
    latest().emit("health", health);
    expect(stream.getState()).toEqual({ connected: true, downSince: null, lastStatus: snapshot, lastHealth: health });
    now = 5_000;
    latest().fail();
    expect(stream.getState()).toMatchObject({ connected: false, downSince: 5_000, lastStatus: snapshot });
  });

  it("delivers typed events to listeners and ignores malformed data", () => {
    const stream = makeStream();
    const onImport = vi.fn();
    const off = stream.on("import", onImport);
    stream.retain();
    latest().emit("import", { listId: 2, phase: "done" });
    latest().emit("import", undefined);
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledWith({ listId: 2, phase: "done" });
    off();
    latest().emit("import", { listId: 3, phase: "done" });
    expect(onImport).toHaveBeenCalledTimes(1);
  });
});

describe("useEventStream", () => {
  async function loadHook() {
    vi.resetModules();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
    return import("./useEventStream");
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function wrapper(client: QueryClient) {
    return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it("shares one EventSource between consumers and exposes the connection state", async () => {
    const { useEventStream } = await loadHook();
    const client = new QueryClient();
    function Consumer({ id }: { id: string }) {
      const { connected } = useEventStream();
      return <span data-testid={id}>{connected ? "up" : "down"}</span>;
    }
    const view = render(
      <>
        <Consumer id="a" />
        <Consumer id="b" />
      </>,
      { wrapper: wrapper(client) },
    );
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(latest().url).toBe("/api/events");
    expect(screen.getByTestId("a")).toHaveTextContent("down");
    act(() => latest().open());
    expect(screen.getByTestId("b")).toHaveTextContent("up");
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(latest().closed).toBe(true);
  });

  it("writes status and health into the cache and invalidates dependent queries once", async () => {
    const { useEventStream } = await loadHook();
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    function Consumer() {
      useEventStream();
      return null;
    }
    render(
      <>
        <Consumer />
        <Consumer />
      </>,
      { wrapper: wrapper(client) },
    );
    act(() => {
      latest().open();
      latest().emit("status", snapshot);
      latest().emit("health", health);
    });
    expect(client.getQueryData(["status"])).toEqual(snapshot);
    expect(client.getQueryData(["health"])).toEqual(health);

    act(() => {
      for (let i = 0; i < 5; i++) latest().emit("worker", { type: "sent", campaignId: 1, message: "ok", at: "" });
      latest().emit("import", { listId: 4, phase: "done" });
    });
    expect(invalidate).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    const keys = invalidate.mock.calls.map(([filters]) => (filters as { queryKey: string[] }).queryKey[0]).sort();
    expect(keys).toEqual(["analytics", "campaigns", "lists", "status"]);
  });

  it("refreshes cached lists after a reconnect", async () => {
    const { useEventStream } = await loadHook();
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    function Consumer() {
      useEventStream();
      return null;
    }
    render(<Consumer />, { wrapper: wrapper(client) });
    act(() => latest().open());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(invalidate).not.toHaveBeenCalled();

    act(() => latest().fail());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    act(() => latest().open());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    const keys = invalidate.mock.calls.map(([filters]) => (filters as { queryKey: string[] }).queryKey[0]).sort();
    expect(keys).toEqual(["analytics", "campaigns", "lists", "status"]);
  });
});
