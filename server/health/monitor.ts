import type { DatabaseSync } from "node:sqlite";
import { getSetting, setSetting } from "../db/settings.ts";
import type { Health, HealthItem } from "../http/contract.ts";
import { dnsProbe } from "../send/async.ts";
import { ACTIVE_STATUSES } from "../send/sendState.ts";
import { DEFAULT_SEND_TIMEOUT_MS, type WorkerActivity } from "../send/worker.ts";

export type PersistedPart = "smtp" | "dns";

const NETWORK_TTL_MS = 60_000;
const IN_FLIGHT_GRACE_MS = 30_000;
const IDLE_FLOOR_MS = 60_000;
const KEYS: Record<PersistedPart, string> = { smtp: "health_smtp_json", dns: "health_dns_json" };
const UNKNOWN_DETAIL: Record<PersistedPart | "network", string> = {
  smtp: "Not tested yet; use Test connection",
  dns: "Not checked yet; use Check DNS",
  network: "Enter the SMTP host to check the network",
};
const STATUSES: ReadonlySet<string> = new Set(["ok", "fail", "unknown"]);

export interface HealthMonitorOptions {
  db: DatabaseSync;
  worker: { getActivity(): WorkerActivity };
  getSmtpHost: () => string;
  probeNetwork?: (host: string) => Promise<boolean>;
  now?: () => number;
  sendTimeoutMs?: number;
  onChange?: (health: Health) => void;
}

function unknown(part: PersistedPart | "network"): HealthItem {
  return { status: "unknown", detail: UNKNOWN_DETAIL[part], checkedAt: null };
}

function parseItem(json: string | undefined): HealthItem | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<HealthItem>;
    if (typeof v.status !== "string" || !STATUSES.has(v.status) || typeof v.detail !== "string") return null;
    return { status: v.status, detail: v.detail, checkedAt: typeof v.checkedAt === "string" ? v.checkedAt : null };
  } catch {
    return null;
  }
}

function sameItem(a: HealthItem, b: HealthItem): boolean {
  return a.status === b.status && a.detail === b.detail && a.checkedAt === b.checkedAt;
}

export function workerHealth(a: WorkerActivity, now: number, sendTimeoutMs: number): Health["worker"] {
  const heartbeatAgeMs = Math.max(0, now - a.heartbeatAt);
  const base = { heartbeatAgeMs, loopRunning: a.loopRunning, checkedAt: new Date(now).toISOString() };
  if (a.status === null || !ACTIVE_STATUSES.has(a.status)) {
    return { ...base, status: "ok", detail: a.status ? `Idle (campaign ${a.status})` : "Idle; no campaign is running" };
  }
  if (!a.loopRunning) return { ...base, status: "fail", detail: "The send loop is not running; the watchdog will restart it" };
  if (a.inFlightSince !== null && now - a.inFlightSince > sendTimeoutMs + IN_FLIGHT_GRACE_MS) {
    return { ...base, status: "fail", detail: "A send has been stuck; the watchdog will recover it" };
  }
  const idleThreshold = Math.max(IDLE_FLOOR_MS, 3 * (a.delaySeconds ?? 0) * 1000 + IDLE_FLOOR_MS);
  if (a.inFlightSince === null && now - Math.max(a.heartbeatAt, a.expectedWakeAt ?? 0) > idleThreshold) {
    return { ...base, status: "fail", detail: "The send loop has stalled; the watchdog will restart it" };
  }
  const detail =
    a.status === "waiting_window" ? "Waiting for the send window" : a.status === "waiting_network" ? "Waiting for the network" : "Sending";
  return { ...base, status: "ok", detail };
}

export class HealthMonitor {
  private readonly db: DatabaseSync;
  private readonly worker: { getActivity(): WorkerActivity };
  private readonly getSmtpHost: () => string;
  private readonly probeNetwork: (host: string) => Promise<boolean>;
  private readonly now: () => number;
  private readonly sendTimeoutMs: number;
  private readonly onChange: (health: Health) => void;
  private readonly persisted: Record<PersistedPart, HealthItem>;
  private network: HealthItem = unknown("network");
  private networkHost = "";
  private networkAt = 0;
  private probing: Promise<void> | null = null;

  constructor(opts: HealthMonitorOptions) {
    this.db = opts.db;
    this.worker = opts.worker;
    this.getSmtpHost = opts.getSmtpHost;
    this.probeNetwork = opts.probeNetwork ?? dnsProbe;
    this.now = opts.now ?? Date.now;
    this.sendTimeoutMs = opts.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
    this.onChange = opts.onChange ?? (() => {});
    this.persisted = {
      smtp: parseItem(getSetting(this.db, KEYS.smtp)) ?? unknown("smtp"),
      dns: parseItem(getSetting(this.db, KEYS.dns)) ?? unknown("dns"),
    };
  }

  get(): Health {
    return {
      smtp: { ...this.persisted.smtp },
      dns: { ...this.persisted.dns },
      network: { ...this.network },
      worker: workerHealth(this.worker.getActivity(), this.now(), this.sendTimeoutMs),
    };
  }

  set(part: PersistedPart, item: HealthItem): void {
    if (sameItem(this.persisted[part], item)) return;
    this.persisted[part] = { ...item };
    setSetting(this.db, KEYS[part], JSON.stringify(item));
    this.notify();
  }

  reset(part: PersistedPart): void {
    this.set(part, unknown(part));
  }

  async refresh(): Promise<Health> {
    const host = this.getSmtpHost().trim();
    const stale = host !== this.networkHost || this.now() - this.networkAt >= NETWORK_TTL_MS;
    if (stale) {
      this.probing ??= this.probe(host).finally(() => {
        this.probing = null;
      });
      await this.probing;
    }
    return this.get();
  }

  notify(): void {
    try {
      this.onChange(this.get());
    } catch {
      // A broken listener must not fail the request that changed the health.
    }
  }

  private async probe(host: string): Promise<void> {
    let item: HealthItem;
    if (!host) item = unknown("network");
    else {
      const ok = await Promise.resolve()
        .then(() => this.probeNetwork(host))
        .then(Boolean, () => false);
      const checkedAt = new Date(this.now()).toISOString();
      item = ok
        ? { status: "ok", detail: `Resolved ${host}`, checkedAt }
        : { status: "fail", detail: `Could not resolve ${host}; check the internet connection and the SMTP host`, checkedAt };
    }
    this.networkHost = host;
    this.networkAt = this.now();
    const changed = this.network.status !== item.status || this.network.detail !== item.detail;
    this.network = item;
    if (changed) this.notify();
  }
}
