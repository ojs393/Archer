import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db/transaction.ts";
import { isRoleAddress } from "../domain/email.ts";
import { checkDomains, type DomainStatus } from "./mx.ts";

const DOMAIN_CONCURRENCY = 10;

export interface PruneResult {
  deleted: number;
  rolesDeleted: number;
}

export async function pruneInvalidDomains(
  db: DatabaseSync,
  listId: number,
  check: (d: string) => Promise<DomainStatus>,
  onProgress?: (done: number, total: number) => void,
): Promise<PruneResult> {
  const domains = (
    db.prepare("SELECT DISTINCT domain FROM contacts WHERE list_id = ?").all(listId) as { domain: string }[]
  ).map((r) => r.domain);
  onProgress?.(0, domains.length);
  const statuses = await checkDomains(domains, check, DOMAIN_CONCURRENCY, onProgress);
  const invalid = domains.filter((d) => statuses.get(d) === "invalid");
  const result: PruneResult = { deleted: 0, rolesDeleted: 0 };
  if (invalid.length === 0) return result;

  transaction(db, () => {
    const emails = db.prepare("SELECT email FROM contacts WHERE list_id = ? AND domain = ?");
    const remove = db.prepare("DELETE FROM contacts WHERE list_id = ? AND domain = ?");
    for (const domain of invalid) {
      for (const row of emails.iterate(listId, domain) as Iterable<{ email: string }>) {
        if (isRoleAddress(row.email)) result.rolesDeleted++;
      }
      result.deleted += Number(remove.run(listId, domain).changes);
    }
  });
  return result;
}
