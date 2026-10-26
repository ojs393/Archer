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

export class ImportJobs {
  private readonly running = new Map<number, Promise<void>>();

  constructor(
    private readonly opts: {
      db: DatabaseSync;
      events: EventHub;
      createDomainChecker: () => (domain: string) => Promise<DomainStatus>;
      log: Logger;
    },
  ) {}

  isRunning(listId: number): boolean {
    return this.running.has(listId);
  }

  start(listId: number, filePath: string, job: ImportJobOptions): void {
    const run = this.run(listId, filePath, job).finally(() => this.running.delete(listId));
    this.running.set(listId, run);
  }

  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running.values()]);
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
