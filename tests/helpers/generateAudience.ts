import fs from "node:fs";
import { once } from "node:events";
import type { DatabaseSync } from "node:sqlite";
import { createList } from "../../server/import/lists.ts";

export type GeneratedContact = {
  email: string;
  first_name: string;
  company: string;
};

/** Deterministic audience for scale / personalization asserts. */
export function generateContacts(n: number): GeneratedContact[] {
  const out: GeneratedContact[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      email: `user${i}@domain${i % 200}.example.com`,
      first_name: `Name${i}`,
      company: `Co${i % 50}`,
    });
  }
  return out;
}

export async function writeAudienceCsv(filePath: string, n: number): Promise<void> {
  const out = fs.createWriteStream(filePath);
  out.write("email,first_name,company\n");
  for (let i = 0; i < n; i++) {
    const line = `user${i}@domain${i % 200}.example.com,Name${i},Co${i % 50}\n`;
    if (!out.write(line)) await once(out, "drain");
  }
  out.end();
  await once(out, "finish");
}

/** Insert a ready list with personalized fields for worker-driven scale tests. */
export function seedPersonalizedList(
  db: DatabaseSync,
  n: number,
): { listId: number; byEmail: Map<string, GeneratedContact> } {
  const listId = createList(db, {
    name: `scale-${n}`,
    sourceLabel: "generated",
    consentText: "test consent",
    excludeRoles: true,
  });
  db.prepare("UPDATE lists SET status = 'ready', valid_count = ?, total_rows = ? WHERE id = ?").run(n, n, listId);
  const insert = db.prepare(
    "INSERT INTO contacts (list_id, email, domain, fields_json) VALUES (?, ?, ?, ?)",
  );
  const byEmail = new Map<string, GeneratedContact>();
  const contacts = generateContacts(n);
  for (const c of contacts) {
    const domain = c.email.split("@")[1]!;
    insert.run(listId, c.email, domain, JSON.stringify({ first_name: c.first_name, company: c.company }));
    byEmail.set(c.email, c);
  }
  return { listId, byEmail };
}

/** Default CI size; set ARCHER_SCALE_SEND=nightly for 50k. */
export function scaleSendCount(): number {
  const raw = process.env.ARCHER_SCALE_SEND?.trim().toLowerCase();
  if (raw === "nightly" || raw === "50000" || raw === "50k") return 50_000;
  if (raw && /^\d+$/.test(raw)) return Math.max(1, Number(raw));
  return 5_000;
}
