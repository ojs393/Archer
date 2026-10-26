import type { ServerResponse } from "node:http";

const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DEFAULT_PING_MS = 15_000;
const RECONNECT_MS = 2_000;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-store, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
};

export function formatEvent(name: string, data: unknown): string {
  if (!EVENT_NAME.test(name)) throw new Error(`Invalid SSE event name ${JSON.stringify(name)}`);
  const json = (JSON.stringify(data) ?? "null").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `event: ${name}\ndata: ${json}\n\n`;
}

export class EventHub {
  private readonly clients = new Set<ServerResponse>();
  private readonly pingMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: { pingMs?: number } = {}) {
    this.pingMs = opts.pingMs ?? DEFAULT_PING_MS;
  }

  get size(): number {
    return this.clients.size;
  }

  subscribe(res: ServerResponse, initial: { name: string; data: unknown }[] = []): void {
    res.writeHead(200, SSE_HEADERS);
    const socket = res.socket as Partial<NonNullable<ServerResponse["socket"]>> | null;
    if (typeof socket?.setNoDelay === "function") socket.setNoDelay(true);
    if (typeof socket?.setTimeout === "function") socket.setTimeout(0);
    this.clients.add(res);
    const drop = () => this.drop(res);
    res.once("close", drop);
    res.once("error", drop);
    this.write(res, `retry: ${RECONNECT_MS}\n\n`);
    for (const event of initial) this.write(res, formatEvent(event.name, event.data));
    this.ensureTimer();
  }

  publish(name: string, data: unknown): void {
    if (this.clients.size === 0) return;
    const frame = formatEvent(name, data);
    for (const res of [...this.clients]) this.write(res, frame);
  }

  closeAll(): void {
    for (const res of [...this.clients]) {
      this.drop(res);
      try {
        res.end();
      } catch {
        // The socket is already gone.
      }
    }
  }

  private write(res: ServerResponse, frame: string): void {
    if (res.destroyed || res.writableEnded) return this.drop(res);
    // A client that stopped reading must not make the server buffer events without bound.
    if (res.writableLength > MAX_BUFFERED_BYTES) {
      this.drop(res);
      res.destroy();
      return;
    }
    try {
      res.write(frame);
    } catch {
      this.drop(res);
    }
  }

  private drop(res: ServerResponse): void {
    this.clients.delete(res);
    if (this.clients.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const res of [...this.clients]) this.write(res, ": ping\n\n");
    }, this.pingMs);
    this.timer.unref();
  }
}
