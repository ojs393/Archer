import { EventEmitter } from "node:events";
import type { DatabaseSync } from "node:sqlite";
import { addSuppression, isSuppressed } from "../db/suppression.ts";
import { transaction } from "../db/transaction.ts";
import { classifySmtpError, type Classified } from "../domain/classifyError.ts";
import {
  NoSendWindowError,
  isWithinWindow,
  localDateKey,
  nextSendTime,
  validateSchedule,
  warmupQuota,
  windowBounds,
  type Schedule,
} from "../domain/schedule.ts";
import { MalformedTemplateError, MissingVariableError } from "../domain/template.ts";
import { addDays, zonedToUtc } from "../domain/zonedTime.ts";
import { abortableSleep, dnsProbe, nextTurn, runCapped, settlesWithin, untilAborted, type CappedResult } from "./async.ts";
import { composeMessage, longDate } from "./compose.ts";
import { EventLog, type SafetyConfig, type WorkerEvent, type WorkerEventType } from "./events.ts";
import { ACTIVE_STATUSES, SendStore, type CampaignRow, type CampaignStatus, type SendRow } from "./sendState.ts";
import { buildTransport, type MailTransport, type OutgoingMessage, type SmtpConfig } from "./transport.ts";

export type { CampaignStatus } from "./sendState.ts";
export type { WorkerEvent } from "./events.ts";

export interface SenderConfig {
  smtp: SmtpConfig;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  postalAddress: string;
  unsubMailbox: string;
  publicBaseUrl: string | null;
  unsubSecret: string;
}

export interface WorkerDeps {
  db: DatabaseSync;
  getSenderConfig: () => SenderConfig;
  createTransport?: (cfg: SmtpConfig) => MailTransport;
  now?: () => Date;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  probeNetwork?: (host: string) => Promise<boolean>;
  retryDelaysMs?: number[];
  maxAttempts?: number;
  networkProbeIntervalMs?: number;
  sendTimeoutMs?: number;
  safety?: SafetyConfig;
  /** Fired after a successful delivery — used by the watchdog to reset recovery counts. */
  onProgress?: () => void;
  /** Fired when a campaign reaches completed (e.g. queue next chain step). */
  onCampaignCompleted?: (campaignId: number) => void;
  /** Test-only: override EventLog ring size / trim cadence. */
  eventLog?: { keep?: number; trimEvery?: number };
}

export interface WorkerActivity {
  campaignId: number | null;
  status: CampaignStatus | null;
  heartbeatAt: number;
  inFlightSince: number | null;
  expectedWakeAt: number | null;
  delaySeconds: number | null;
  loopRunning: boolean;
}

type EventInput = { type: WorkerEventType; message: string; contactId?: number; email?: string };
type SendResult = CappedResult<{ messageId: string; response: string }> | { kind: "not_sent" };
type Step = "continue" | "exit";
type AttemptOutcome = Step | "delay";
type StatusOptions = { message?: string; onlyFrom?: ReadonlySet<CampaignStatus> };
type Prepared = { sender: SenderConfig; message: OutgoingMessage; transport: MailTransport };

export const DEFAULT_SEND_TIMEOUT_MS = 120_000;

const DEFAULT_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000];
const UNEXPECTED_BACKOFF_MS = 5_000;
const MAX_CONSECUTIVE_LOOP_ERRORS = 5;
const SHUTDOWN_GRACE_MS = 1_000;
const MAX_TIMER_MS = 2_147_483_647;
const SAFETY_RESET_MESSAGE = "Status: running (rejection sample reset after safety stop)";
const WAITING_NETWORK: ReadonlySet<CampaignStatus> = new Set(["waiting_network"]);
const COMPLIANCE_FIELDS = [
  ["fromName", "from name"],
  ["postalAddress", "postal address"],
  ["unsubMailbox", "unsubscribe mailbox"],
  ["fromEmail", "from address"],
] as const;

function missingComplianceFields(sender: SenderConfig): string[] {
  return COMPLIANCE_FIELDS.filter(([key]) => !sender[key]?.trim()).map(([, label]) => label);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusMessage(status: CampaignStatus, reason: string | null): string {
  return `Status: ${status}${reason ? ` (${reason})` : ""}`;
}

function parseSchedule(json: string): Schedule {
  return JSON.parse(json) as Schedule;
}

export class SendWorker extends EventEmitter {
  private readonly db: DatabaseSync;
  private readonly store: SendStore;
  private readonly log: EventLog;
  private readonly getSenderConfig: () => SenderConfig;
  private readonly createTransport: (cfg: SmtpConfig) => MailTransport;
  private readonly now: () => Date;
  private readonly sleepFn: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly probeNetwork: (host: string) => Promise<boolean>;
  private readonly retryDelaysMs: number[];
  private readonly maxAttempts: number;
  private readonly networkProbeIntervalMs: number;
  private readonly sendTimeoutMs: number;
  private readonly safety: SafetyConfig;
  private readonly onProgress: (() => void) | null;
  private readonly onCampaignCompleted: ((campaignId: number) => void) | null;

  private campaignId: number | null = null;
  private status: CampaignStatus | null = null;
  private heartbeatAt = 0;
  private inFlightSince: number | null = null;
  private expectedWakeAt: number | null = null;
  private delaySeconds: number | null = null;
  private loop: Promise<void> | null = null;
  private napCtl = new AbortController();
  private iteration = new AbortController();
  private transport: MailTransport | null = null;
  private transportKey = "";
  private safetyFloor = 0;
  private shuttingDown = false;

  constructor(deps: WorkerDeps) {
    super();
    this.db = deps.db;
    this.store = new SendStore(deps.db);
    this.log = new EventLog(deps.db, deps.eventLog);
    this.getSenderConfig = deps.getSenderConfig;
    this.createTransport = deps.createTransport ?? buildTransport;
    this.now = deps.now ?? (() => new Date());
    this.sleepFn = deps.sleep ?? abortableSleep;
    this.random = deps.random ?? Math.random;
    this.probeNetwork = deps.probeNetwork ?? dnsProbe;
    this.retryDelaysMs = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.maxAttempts = deps.maxAttempts ?? 5;
    this.networkProbeIntervalMs = deps.networkProbeIntervalMs ?? 15_000;
    this.sendTimeoutMs = deps.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
    this.safety = deps.safety ?? { window: 200, minSample: 50, threshold: 0.05 };
    this.onProgress = deps.onProgress ?? null;
    this.onCampaignCompleted = deps.onCampaignCompleted ?? null;
    this.heartbeatAt = this.now().getTime();
  }

  recoverOnBoot(): { uncertain: number; resumeCampaignId: number | null } {
    let uncertain = 0;
    for (const row of this.store.sendingRows()) {
      if (this.markUncertain(row.campaign_id, row, "interrupted mid-send by a restart")) uncertain += 1;
    }
    const resumeCampaignId = this.store.latestActiveCampaign();
    const adopt = resumeCampaignId ?? this.store.latestHeldCampaign();
    if (adopt !== null && this.campaignId === null) {
      this.campaignId = adopt;
      this.status = this.store.campaign(adopt)?.status ?? null;
    }
    return { uncertain, resumeCampaignId };
  }

  start(campaignId: number): void {
    if (this.shuttingDown) throw new Error("The send worker is shutting down");
    const c = this.store.campaign(campaignId);
    if (!c) throw new Error(`Campaign ${campaignId} not found`);
    if (c.status === "stopped") throw new Error(`Campaign ${campaignId} was stopped and cannot be restarted`);
    const held = this.store.otherHeldCampaign(campaignId);
    if (held !== undefined) throw new Error(`Campaign ${held} is already active; stop it first`);
    const errors = validateSchedule(parseSchedule(c.schedule_json));
    if (errors.length > 0) throw new Error(`Invalid schedule: ${errors.join(" ")}`);
    this.campaignId = campaignId;
    this.activate(c);
  }

  pause(reason: string): void {
    const id = this.campaignId;
    if (id === null) return;
    if (this.isActive(id)) this.setStatus(id, "paused", reason);
    // Abort in-flight SMTP too — nap-only abort left hung sends stuck after watchdog give-up.
    this.iteration.abort();
    this.napCtl.abort();
    this.rebuildTransport();
  }

  resume(): void {
    const id = this.campaignId;
    if (id === null) throw new Error("No campaign to resume");
    const c = this.store.campaign(id);
    if (c && (c.status === "paused" || c.status === "safety_stop")) this.activate(c);
  }

  stop(): void {
    const id = this.campaignId;
    if (id === null) return;
    const status = this.store.campaign(id)?.status;
    if (status !== undefined && status !== "completed" && status !== "stopped") this.setStatus(id, "stopped", null);
    this.iteration.abort();
    this.napCtl.abort();
    this.rebuildTransport();
  }

  requeueUncertain(campaignId: number, contactIds?: number[]): number {
    return this.store.requeueUncertain(campaignId, contactIds, this.now().toISOString());
  }

  getActivity(): WorkerActivity {
    return {
      campaignId: this.campaignId,
      status: this.status,
      heartbeatAt: this.heartbeatAt,
      inFlightSince: this.inFlightSince,
      expectedWakeAt: this.expectedWakeAt,
      delaySeconds: this.delaySeconds,
      loopRunning: this.loop !== null,
    };
  }

  restartLoop(reason: string): void {
    const id = this.campaignId;
    if (id !== null) this.safely(() => this.apply(id, () => [{ type: "error", message: `Send loop restarted: ${reason}` }]));
    this.rebuildTransport();
    this.iteration.abort();
    this.napCtl.abort();
    if (id !== null && this.isActiveSafe(id)) this.launch(id);
  }

  wake(_reason: string): void {
    if (this.expectedWakeAt !== null) this.napCtl.abort();
  }

  rebuildTransport(): void {
    const old = this.transport;
    this.transport = null;
    this.transportKey = "";
    this.safely(() => old?.close());
  }

  async shutdown(timeoutMs: number): Promise<void> {
    this.shuttingDown = true;
    this.napCtl.abort();
    const loop = this.loop;
    if (loop && !(await settlesWithin(loop, timeoutMs))) {
      this.iteration.abort();
      await settlesWithin(loop, SHUTDOWN_GRACE_MS);
    }
    this.rebuildTransport();
  }

  private activate(c: CampaignRow): void {
    this.setStatus(c.id, "running", null, c.status === "safety_stop" ? { message: SAFETY_RESET_MESSAGE } : {});
    this.safetyFloor = this.log.lastIdOf(c.id, "status", SAFETY_RESET_MESSAGE);
    this.launch(c.id);
  }

  private launch(id: number): void {
    if (this.loop || this.shuttingDown) return;
    this.loop = this.runLoop(id)
      .catch((err: unknown) => this.recordLoopError(id, err))
      .finally(() => {
        this.loop = null;
        const next = this.campaignId;
        if (next !== null && this.isActiveSafe(next)) setImmediate(() => this.launch(next));
      });
  }

  private async runLoop(id: number): Promise<void> {
    let consecutiveErrors = 0;
    while (!this.shuttingDown && this.campaignId === id) {
      await nextTurn();
      if (this.shuttingDown || this.campaignId !== id) break;
      this.iteration = new AbortController();
      try {
        const step = await this.step(id, this.iteration.signal);
        consecutiveErrors = 0;
        if (step === "exit") break;
      } catch (err) {
        consecutiveErrors += 1;
        this.recordLoopError(id, err);
        if (consecutiveErrors >= MAX_CONSECUTIVE_LOOP_ERRORS) {
          this.safely(() => this.setLoopStatus(id, "paused", "unexpected_error"));
          if (!this.isActiveSafe(id)) break;
        }
        await this.napFor(UNEXPECTED_BACKOFF_MS);
      }
    }
  }

  private recordLoopError(id: number, err: unknown): void {
    this.safely(() => this.apply(id, () => [{ type: "error", message: `Unexpected error in send loop: ${errorText(err)}` }]));
  }

  private async step(id: number, signal: AbortSignal): Promise<Step> {
    this.beat();
    const c = this.store.campaign(id);
    if (!c || !ACTIVE_STATUSES.has(c.status)) return "exit";
    this.status = c.status;
    // Orphan `sending` rows (crash mid-mark, give-up hang) must not wait for an empty queue.
    if (this.inFlightSince === null) {
      for (const row of this.store.sendingRows(id)) {
        this.markUncertain(id, row, "found mid-send with nothing in flight");
      }
    }
    const schedule = parseSchedule(c.schedule_json);
    this.delaySeconds = schedule.delaySeconds;
    const now = this.now();

    let wakeAt: Date | null;
    try {
      wakeAt = this.windowWait(id, schedule, now);
    } catch (err) {
      if (!(err instanceof NoSendWindowError)) throw err;
      this.setLoopStatus(id, "paused", "no_send_window");
      return "exit";
    }
    if (wakeAt) {
      this.setLoopStatus(id, "waiting_window", null);
      await this.napUntil(wakeAt);
      return "continue";
    }
    if (c.status !== "running") this.setLoopStatus(id, "running", null);

    const row = this.store.nextDue(id, now.toISOString());
    if (!row) return this.idle(id, schedule, now);
    if (isSuppressed(this.db, row.email)) {
      this.apply(id, (at) =>
        this.store.markSkipped(id, row.contact_id, at)
          ? [{ type: "skipped", contactId: row.contact_id, email: row.email, message: `Skipped ${row.email}: on the suppression list` }]
          : [],
      );
      return "continue";
    }

    if (!this.store.markSending(id, row.contact_id, this.now().toISOString())) return "continue";
    this.inFlightSince = this.now().getTime();
    let outcome: AttemptOutcome;
    try {
      outcome = await this.attempt(c, schedule, row, signal);
    } finally {
      this.inFlightSince = null;
      this.beat();
    }
    if (outcome !== "delay") return outcome;
    await this.pace(id, this.now().getTime() + schedule.delaySeconds * 1000 * this.jitter(), signal);
    return "continue";
  }

  private async pace(id: number, until: number, signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !this.shuttingDown && this.isActive(id)) {
      const left = until - this.now().getTime();
      if (left <= 0) return;
      await this.nap(left, until);
    }
  }

  private windowWait(id: number, s: Schedule, now: Date): Date | null {
    if (!isWithinWindow(now, s)) return nextSendTime(now, s);
    const today = localDateKey(now, s.timezone);
    const quota = warmupQuota(this.store.sendDaysBefore(id, today), s.dailyCap, s.warmup);
    if (this.store.sentOn(id, today) < quota) return null;
    return nextSendTime(zonedToUtc(addDays(today, 1), 0, s.timezone), s);
  }

  private async idle(id: number, s: Schedule, now: Date): Promise<Step> {
    const earliest = this.store.earliestRetry(id);
    if (earliest !== null) {
      const windowEnd = windowBounds(localDateKey(now, s.timezone), s).end.getTime();
      await this.napUntil(new Date(Math.min(Date.parse(earliest), windowEnd)));
      return "continue";
    }
    const stale = this.store.sendingRows(id);
    for (const row of stale) this.markUncertain(id, row, "found mid-send with nothing in flight");
    if (stale.length > 0 || this.store.hasOpenRows(id)) return "continue";
    this.setLoopStatus(id, "completed", null);
    try {
      this.onCampaignCompleted?.(id);
    } catch {
      // Chain advance must not break the send loop.
    }
    return "exit";
  }

  private async attempt(c: CampaignRow, s: Schedule, row: SendRow, signal: AbortSignal): Promise<AttemptOutcome> {
    let prepared: Prepared | AttemptOutcome;
    try {
      prepared = this.prepare(c, s, row);
    } catch (err) {
      return this.holdRow(c.id, row, "internal_error", `Internal error before sending to ${row.email}: ${errorText(err)}`);
    }
    if (typeof prepared === "string") return prepared;
    try {
      return await this.deliver(c.id, s, row, prepared, signal);
    } catch (err) {
      this.safely(() => this.markUncertain(c.id, row, `unexpected error during send: ${errorText(err)}`));
      throw err;
    }
  }

  private prepare(c: CampaignRow, s: Schedule, row: SendRow): Prepared | AttemptOutcome {
    const sender = this.getSenderConfig();
    const missing = missingComplianceFields(sender);
    if (missing.length > 0) return this.holdRow(c.id, row, "compliance_config", `Sending blocked: ${missing.join(", ")} not set`);
    const tpl = this.store.template(c.template_id);
    if (!tpl || tpl.version !== c.template_version) return this.holdRow(c.id, row, "template_changed");
    let message: OutgoingMessage;
    try {
      message = composeMessage(this.db, tpl, row, sender, longDate(this.now(), s.timezone));
    } catch (err) {
      if (err instanceof MalformedTemplateError) return this.holdRow(c.id, row, "template_error");
      if (!(err instanceof MissingVariableError)) throw err;
      return this.recordFailure(c.id, row, "failed", err.message, null) === "exit" ? "exit" : "continue";
    }
    return { sender, message, transport: this.transportFor(sender.smtp) };
  }

  private async deliver(id: number, s: Schedule, row: SendRow, p: Prepared, signal: AbortSignal): Promise<AttemptOutcome> {
    const { sender } = p;
    const result = await this.sendCapped(p.transport, p.message, signal);
    this.inFlightSince = null;
    this.beat();
    switch (result.kind) {
      case "ok":
        return this.recordSent(id, s, row, result.value);
      case "not_sent":
        this.revertRow(id, row);
        return "continue";
      case "aborted":
        this.markUncertain(id, row, "send interrupted before the server replied; it may have been delivered");
        return "continue";
      case "timeout":
        this.markUncertain(id, row, `no reply within ${Math.round(this.sendTimeoutMs / 1000)}s; it may have been delivered`);
        this.rebuildTransport();
        await this.waitForNetwork(id, sender.smtp.host, signal);
        return "delay";
      case "error":
        return this.handleError(id, row, result.err, sender.smtp.host, signal);
    }
  }

  private async handleError(id: number, row: SendRow, err: unknown, host: string, signal: AbortSignal): Promise<AttemptOutcome> {
    const cls = classifySmtpError(err);
    const response = typeof (err as { response?: unknown })?.response === "string" ? (err as { response: string }).response : null;
    switch (cls.kind) {
      case "retry":
        return this.retryOrFail(id, row, cls, response);
      case "network": {
        if (cls.command === "DATA") {
          this.markUncertain(id, row, `connection lost after the message was handed over (${cls.message}); it may have been delivered`);
        } else if (this.retryOrFail(id, row, cls, response) === "exit") {
          return "exit";
        }
        this.rebuildTransport();
        await this.waitForNetwork(id, host, signal);
        return "delay";
      }
      case "suppress":
        return this.recordFailure(id, row, "suppressed", cls.message, response);
      case "fail":
        return this.recordFailure(id, row, "failed", cls.message, response);
      case "auth":
      case "config": {
        const what = cls.kind === "auth" ? "SMTP login failed" : "SMTP configuration problem";
        this.apply(id, (at) => {
          this.store.revertToPending(id, row.contact_id, at);
          return [{ type: "error", contactId: row.contact_id, email: row.email, message: `${what}: ${cls.message}` }];
        });
        this.setLoopStatus(id, "paused", cls.kind === "auth" ? "auth_failed" : "config_error");
        return "exit";
      }
    }
  }

  private retryOrFail(id: number, row: SendRow, cls: Classified, response: string | null): AttemptOutcome {
    const attempts = row.attempts + 1;
    if (attempts >= this.maxAttempts) return this.recordFailure(id, row, "failed", `${cls.message} (after ${attempts} attempts)`, response);
    const base = this.retryDelaysMs[Math.min(attempts - 1, this.retryDelaysMs.length - 1)];
    const nextAt = new Date(this.now().getTime() + base * this.jitter()).toISOString();
    this.apply(id, (at) =>
      this.store.markRetry(id, row.contact_id, nextAt, cls.message, response, at)
        ? [{ type: "retry", contactId: row.contact_id, email: row.email, message: `Retry ${attempts + 1}/${this.maxAttempts} for ${row.email} at ${nextAt}: ${cls.message}` }]
        : [],
    );
    return "delay";
  }

  private recordFailure(id: number, row: SendRow, type: "failed" | "suppressed", error: string, response: string | null): AttemptOutcome {
    this.apply(id, (at) => {
      if (!this.store.markFailed(id, row.contact_id, error, response, at)) return [];
      if (type === "suppressed") addSuppression(this.db, row.email, "hard_bounce");
      const verb = type === "suppressed" ? "Suppressed" : "Failed";
      return [{ type, contactId: row.contact_id, email: row.email, message: `${verb} ${row.email}: ${error}` }];
    });
    return this.afterOutcome(id);
  }

  private recordSent(id: number, s: Schedule, row: SendRow, info: { messageId: string; response: string }): AttemptOutcome {
    const day = localDateKey(this.now(), s.timezone);
    this.apply(id, (at) =>
      this.store.markSent(id, row.contact_id, info, day, at)
        ? [{ type: "sent", contactId: row.contact_id, email: row.email, message: `Sent to ${row.email}` }]
        : [],
    );
    try {
      this.onProgress?.();
    } catch {
      // Watchdog progress hooks must not break the send loop.
    }
    return this.afterOutcome(id);
  }

  private afterOutcome(id: number): AttemptOutcome {
    if (!this.log.rejectionRateExceeded(id, this.safetyFloor, this.safety)) return "delay";
    this.setLoopStatus(id, "safety_stop", "rejection_rate");
    return "exit";
  }

  private holdRow(id: number, row: SendRow, reason: string, error?: string): Step {
    this.revertRow(id, row, error);
    this.setLoopStatus(id, "paused", reason);
    return "exit";
  }

  private revertRow(id: number, row: SendRow, error?: string): void {
    this.apply(id, (at) => {
      this.store.revertToPending(id, row.contact_id, at);
      return error === undefined ? [] : [{ type: "error", contactId: row.contact_id, email: row.email, message: error }];
    });
  }

  private markUncertain(id: number, row: SendRow, why: string): boolean {
    const events = this.apply(id, (at) =>
      this.store.markUncertain(id, row.contact_id, why, at)
        ? [{ type: "uncertain", contactId: row.contact_id, email: row.email, message: `Uncertain ${row.email}: ${why}. Not resent automatically.` }]
        : [],
    );
    return events.length > 0;
  }

  private async waitForNetwork(id: number, host: string, signal: AbortSignal): Promise<void> {
    if ((await this.probe(host, signal)) || signal.aborted) return;
    if (!this.setLoopStatus(id, "waiting_network", null)) return;
    while (!signal.aborted && !this.shuttingDown && this.store.campaign(id)?.status === "waiting_network") {
      await this.napFor(this.networkProbeIntervalMs);
      if (signal.aborted || this.store.campaign(id)?.status !== "waiting_network") return;
      const ok = await this.probe(host, signal);
      if (signal.aborted || this.shuttingDown) return;
      if (ok) {
        this.rebuildTransport();
        this.setStatus(id, "running", null, { onlyFrom: WAITING_NETWORK });
        return;
      }
    }
  }

  private async probe(host: string, signal: AbortSignal): Promise<boolean> {
    const probed = Promise.resolve()
      .then(() => this.probeNetwork(host))
      .then(Boolean, () => false);
    const ok = await untilAborted(probed, signal, false);
    this.beat();
    return ok;
  }

  private sendCapped(transport: MailTransport, message: OutgoingMessage, signal: AbortSignal): Promise<SendResult> {
    if (signal.aborted) return Promise.resolve({ kind: "not_sent" });
    return runCapped(() => transport.send(message), this.sendTimeoutMs, signal);
  }

  private transportFor(smtp: SmtpConfig): MailTransport {
    const key = JSON.stringify(smtp);
    if (!this.transport || key !== this.transportKey) {
      this.rebuildTransport();
      this.transport = this.createTransport(smtp);
      this.transportKey = key;
    }
    return this.transport;
  }

  private setStatus(id: number, status: CampaignStatus, reason: string | null, opts: StatusOptions = {}): boolean {
    let changed = false;
    this.apply(id, (at) => {
      const current = this.store.campaign(id);
      if (!current || (opts.onlyFrom && !opts.onlyFrom.has(current.status))) return [];
      if (current.status === status && current.pause_reason === reason && opts.message === undefined) return [];
      this.store.setStatus(id, status, reason, at);
      changed = true;
      return [{ type: "status", message: opts.message ?? statusMessage(status, reason) }];
    });
    if (this.campaignId === id) this.status = this.store.campaign(id)?.status ?? null;
    return changed;
  }

  private setLoopStatus(id: number, status: CampaignStatus, reason: string | null): boolean {
    return this.setStatus(id, status, reason, { onlyFrom: ACTIVE_STATUSES });
  }

  private apply(campaignId: number, change: (at: string) => EventInput[]): WorkerEvent[] {
    const at = this.now().toISOString();
    const events = transaction(this.db, () =>
      change(at).map((input) => {
        const event: WorkerEvent = { type: input.type, campaignId, message: input.message, at };
        if (input.contactId !== undefined) event.contactId = input.contactId;
        if (input.email !== undefined) event.email = input.email;
        this.log.insert(event);
        return event;
      }),
    );
    for (const event of events) this.safely(() => this.emit("event", event));
    this.safely(() => this.log.trimIfDue());
    return events;
  }

  private async napUntil(at: Date): Promise<void> {
    await this.nap(at.getTime() - this.now().getTime(), at.getTime());
  }

  private async napFor(ms: number): Promise<void> {
    await this.nap(ms, this.now().getTime() + ms);
  }

  private async nap(ms: number, wakeAt: number): Promise<void> {
    const ctl = this.napCtl;
    if (!ctl.signal.aborted && ms > 0) {
      this.expectedWakeAt = wakeAt;
      try {
        await Promise.resolve()
          .then(() => this.sleepFn(Math.min(ms, MAX_TIMER_MS), ctl.signal))
          .catch(() => {});
      } finally {
        this.expectedWakeAt = null;
      }
    }
    if (ctl.signal.aborted && this.napCtl === ctl) this.napCtl = new AbortController();
    this.beat();
  }

  private jitter(): number {
    return 0.8 + 0.4 * this.random();
  }

  private beat(): void {
    this.heartbeatAt = this.now().getTime();
  }

  private isActive(id: number): boolean {
    const status = this.store.campaign(id)?.status;
    return status !== undefined && ACTIVE_STATUSES.has(status);
  }

  private isActiveSafe(id: number): boolean {
    if (this.shuttingDown) return false;
    try {
      return this.isActive(id);
    } catch {
      return false;
    }
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch {
      // Best effort: listeners, cleanup and error reporting must never break the send loop.
    }
  }
}
