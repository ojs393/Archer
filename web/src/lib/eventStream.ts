import type { Health, ImportEvent, StatusSnapshot, WorkerEvent } from "./types";

export interface StreamEvents {
  worker: WorkerEvent;
  import: ImportEvent;
  status: StatusSnapshot;
  health: Health;
}

export type StreamEventName = keyof StreamEvents;

export interface StreamState {
  connected: boolean;
  /** When the stream was last seen down (or first requested), null while connected or unused. */
  downSince: number | null;
  lastStatus: StatusSnapshot | null;
  lastHealth: Health | null;
}

export interface EventSourceLike {
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  addEventListener(name: string, fn: (ev: MessageEvent) => void): void;
  close(): void;
}

export interface EventStreamOptions {
  url: string;
  createSource?: (url: string) => EventSourceLike;
  /** Runs before every reconnect attempt (for example to re-open the session after a server restart). */
  beforeReconnect?: () => Promise<void>;
  random?: () => number;
  now?: () => number;
}

const EVENT_NAMES: readonly StreamEventName[] = ["worker", "import", "status", "health"];
const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const RELEASE_GRACE_MS = 1_000;

export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * 2 ** Math.min(attempt, 16));
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

type Listeners = { [K in StreamEventName]: Set<(data: StreamEvents[K]) => void> };

export class EventStream {
  private readonly opts: Required<Omit<EventStreamOptions, "beforeReconnect">> & Pick<EventStreamOptions, "beforeReconnect">;
  private source: EventSourceLike | null = null;
  private holders = 0;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private state: StreamState = { connected: false, downSince: null, lastStatus: null, lastHealth: null };
  private readonly stateListeners = new Set<() => void>();
  private readonly listeners: Listeners = { worker: new Set(), import: new Set(), status: new Set(), health: new Set() };

  constructor(opts: EventStreamOptions) {
    this.opts = {
      createSource: (url) => new EventSource(url),
      random: Math.random,
      now: Date.now,
      ...opts,
    };
  }

  getState = (): StreamState => this.state;

  subscribeState = (fn: () => void): (() => void) => {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  };

  on<K extends StreamEventName>(name: K, fn: (data: StreamEvents[K]) => void): () => void {
    const set = this.listeners[name] as Set<(data: StreamEvents[K]) => void>;
    set.add(fn);
    return () => set.delete(fn);
  }

  retain(): () => void {
    this.holders++;
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    if (!this.source && !this.reconnectTimer) {
      this.setState({ downSince: this.state.downSince ?? this.opts.now() });
      this.open();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.holders === 0) this.releaseTimer = setTimeout(() => this.shutdown(), RELEASE_GRACE_MS);
    };
  }

  private open(): void {
    let source: EventSourceLike;
    try {
      source = this.opts.createSource(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.source = source;
    source.onopen = () => {
      if (this.source !== source) return;
      this.attempt = 0;
      if (!this.state.connected) this.setState({ connected: true, downSince: null });
    };
    source.onerror = () => {
      if (this.source !== source) return;
      source.close();
      this.source = null;
      this.setState({ connected: false, downSince: this.state.downSince ?? this.opts.now() });
      this.scheduleReconnect();
    };
    for (const name of EVENT_NAMES) {
      source.addEventListener(name, (ev) => {
        if (this.source === source) this.dispatch(name, ev.data);
      });
    }
  }

  private dispatch(name: StreamEventName, raw: unknown): void {
    let data: unknown;
    try {
      data = typeof raw === "string" ? JSON.parse(raw) : undefined;
    } catch {
      return;
    }
    if (data === null || typeof data !== "object") return;
    if (name === "status") this.setState({ lastStatus: data as StatusSnapshot });
    if (name === "health") this.setState({ lastHealth: data as Health });
    for (const fn of this.listeners[name] as Set<(d: unknown) => void>) {
      try {
        fn(data);
      } catch (err) {
        console.error(`MamaDirect: "${name}" event listener failed`, err);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.holders === 0 || this.reconnectTimer) return;
    const delay = backoffDelay(this.attempt++, this.opts.random);
    this.reconnectTimer = setTimeout(() => void this.reconnect(), delay);
  }

  private async reconnect(): Promise<void> {
    try {
      await this.opts.beforeReconnect?.();
    } catch {
      this.reconnectTimer = null;
      this.scheduleReconnect();
      return;
    }
    this.reconnectTimer = null;
    if (this.holders > 0 && !this.source) this.open();
  }

  private shutdown(): void {
    this.releaseTimer = null;
    if (this.holders > 0) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.source?.close();
    this.source = null;
    this.attempt = 0;
    this.setState({ connected: false, downSince: null });
  }

  private setState(patch: Partial<StreamState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.stateListeners) fn();
  }
}
