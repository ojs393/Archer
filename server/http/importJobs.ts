import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { streamImport, type ImportProgress } from "../import/csv.ts";
import { getList } from "../import/lists.ts";
import type { DomainStatus } from "../import/mx.ts";
import type { Logger } from "../logger.ts";
import type { ImportEvent } from "./contract.ts";
import type { EventHub } from "./events.ts";

const DOMAIN_PROGRESS_EVERY_MS = 250;

export interface ImportJobOptions {
  emailColumn?: string | number;
  excludeRoles: boolean;
  checkDomains: boolean;
}

type QueuedJob = { listId: number; filePath: string; job: ImportJobOptions };

/**
 * Runs imports one at a time so SQLite writers do not fight each other on huge lists.
 * Additional starts queue FIFO and start when the active job finishes.
 */
export class ImportJobs {
  private readonly running = new Map<number, Promise<void>>();
  private readonly queue: QueuedJob[] = [];
  private active: Promise<void> | null = null;

  constructor(
    private readonly opts: {
      db: DatabaseSync;
      events: EventHub;
      createDomainChecker: () => (domain: string) => Promise<DomainStatus>;
      log: Logger;
    },
  ) {}

  isRunning(listId: number): boolean {
    return this.running.has(listId) || this.queue.some((j) => j.listId === listId);
  }

  start(listId: number, filePath: string, job: ImportJobOptions): void {
    this.queue.push({ listId, filePath, job });
    void this.pump();
  }

  async idle(): Promise<void> {
    while (this.active || this.queue.length > 0 || this.running.size > 0) {
      if (this.active) await this.active;
      else if (this.running.size > 0) await Promise.allSettled([...this.running.values()]);
      else await new Promise((r) => setImmediate(r));
    }
  }

  private pump(): void {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    const run = this.run(next.listId, next.filePath, next.job)
      .finally(() => {
        this.running.delete(next.listId);
        this.active = null;
        this.pump();
      });
    this.running.set(next.listId, run);
    this.active = run;
  }

  private publish(event: ImportEvent): void {
    try {
      this.opts.events.publish("import", event);
    } catch {
      // Progress reporting must never fail the import.
    }
  }

  private async run(listId: number, filePath: string, job: ImportJobOptions): Promise<void> {
    const { db, log } = this.opts;
    let lastDomainEvent = 0;
    const onProgress = (p: ImportProgress) => {
      if (p.phase === "checking_domains") {
        const now = Date.now();
        const last = p.domainsChecked === p.domainsTotal;
        if (!last && now - lastDomainEvent < DOMAIN_PROGRESS_EVERY_MS) return;
        lastDomainEvent = now;
      }
      this.publish({ listId, ...p });
    };
    try {
      const result = await streamImport({
        filePath,
        db,
        listId,
        emailColumn: job.emailColumn,
        excludeRoles: job.excludeRoles,
        domainChecker: job.checkDomains ? this.opts.createDomainChecker() : null,
        onProgress,
      });
      const { emailColumn: _column, ...counts } = result;
      log.info(`Import of list ${listId} finished: ${counts.valid} valid of ${counts.totalRows} rows`);
      this.publish({ listId, phase: "done", rowsProcessed: counts.totalRows, counts });
    } catch (err) {
      let error = "Import failed";
      try {
        error = getList(db, listId)?.error ?? error;
      } catch {
        // The database itself failed; the generic message is all we can say.
      }
      log.warn(`Import of list ${listId} failed:`, err);
      this.publish({ listId, phase: "failed", error });
    } finally {
      await fs.promises.rm(filePath, { force: true }).catch((err: unknown) => log.warn(`Could not delete uploaded file ${filePath}:`, err));
    }
  }
}
