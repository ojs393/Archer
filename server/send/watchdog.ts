export interface WatchedWorker {
  getActivity(): {
    campaignId: number | null;
    status: string | null;
    heartbeatAt: number;
    inFlightSince: number | null;
    expectedWakeAt: number | null;
    delaySeconds: number | null;
    loopRunning: boolean;
  };
  restartLoop(reason: string): void;
  rebuildTransport(): void;
  wake(reason: string): void;
  pause(reason: string): void;
}

export interface WatchdogOptions {
  now?: () => number;
  intervalMs?: number;
  sendTimeoutMs?: number;
  maxRecoveries?: number;
  recoveryWindowMs?: number;
  clockJumpMs?: number;
  onLog?: (message: string) => void;
}

const WATCHED_STATUSES: ReadonlySet<string> = new Set(["running", "waiting_window", "waiting_network"]);
const IN_FLIGHT_GRACE_MS = 30_000;
const IDLE_FLOOR_MS = 60_000;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class Watchdog {
  private readonly worker: WatchedWorker;
  private readonly now: () => number;
  private readonly intervalMs: number;
  private readonly sendTimeoutMs: number;
  private readonly maxRecoveries: number;
  private readonly recoveryWindowMs: number;
  private readonly clockJumpMs: number;
  private readonly log: (message: string) => void;
  private timer: NodeJS.Timeout | null = null;
  private lastTick: number | null = null;
  private recoveries: number[] = [];

  constructor(worker: WatchedWorker, opts: WatchdogOptions = {}) {
    this.worker = worker;
    this.now = opts.now ?? Date.now;
    this.intervalMs = opts.intervalMs ?? 5_000;
    this.sendTimeoutMs = opts.sendTimeoutMs ?? 120_000;
    this.maxRecoveries = opts.maxRecoveries ?? 3;
    this.recoveryWindowMs = opts.recoveryWindowMs ?? 600_000;
    this.clockJumpMs = opts.clockJumpMs ?? 30_000;
    this.log = opts.onLog ?? (() => {});
  }

  start(): void {
    if (this.timer) return;
    this.lastTick = null;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick(): void {
    try {
      this.check(this.now());
    } catch (err) {
      this.report(`Watchdog check failed: ${errorText(err)}`);
    }
  }

  private check(now: number): void {
    const last = this.lastTick;
    this.lastTick = now;
    if (last !== null && (now - last > this.intervalMs + this.clockJumpMs || last - now > this.clockJumpMs)) {
      this.report(`Watchdog: clock jumped by ${Math.round((now - last) / 1000)}s (sleep/wake or clock change); rebuilding the SMTP connection and rechecking the schedule`);
      this.worker.rebuildTransport();
      this.worker.wake("clock_jump");
      return;
    }

    const a = this.worker.getActivity();
    if (a.status === null || !WATCHED_STATUSES.has(a.status)) return;
    if (!a.loopRunning) return this.recover("loop_not_running", now);
    if (a.inFlightSince !== null) {
      if (now - a.inFlightSince > this.sendTimeoutMs + IN_FLIGHT_GRACE_MS) this.recover("send_stalled", now);
      return;
    }
    const idleThreshold = Math.max(IDLE_FLOOR_MS, 3 * (a.delaySeconds ?? 0) * 1000 + IDLE_FLOOR_MS);
    if (now - Math.max(a.heartbeatAt, a.expectedWakeAt ?? 0) > idleThreshold) this.recover("loop_stalled", now);
  }

  private recover(reason: string, now: number): void {
    this.recoveries = this.recoveries.filter((at) => now - at < this.recoveryWindowMs);
    if (this.recoveries.length >= this.maxRecoveries) {
      this.recoveries = [];
      this.report(
        `Watchdog: the send loop got stuck (${reason}) after ${this.maxRecoveries} recoveries in ${Math.round(this.recoveryWindowMs / 60_000)} min; giving up and pausing the campaign (watchdog_giveup)`,
      );
      this.worker.pause("watchdog_giveup");
      return;
    }
    this.recoveries.push(now);
    this.report(`Watchdog: ${reason}; restarting the send loop`);
    this.worker.restartLoop(`watchdog: ${reason}`);
  }

  private report(message: string): void {
    try {
      this.log(message);
    } catch {
      // A broken log sink must not stop the watchdog.
    }
  }
}
