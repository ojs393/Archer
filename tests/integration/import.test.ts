import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../server/db/index.ts";
import { addSuppression } from "../../server/db/suppression.ts";
import { streamImport, type ImportOptions, type ImportProgress } from "../../server/import/csv.ts";
import { createList, getList, getListColumns } from "../../server/import/lists.ts";
import type { DomainStatus } from "../../server/import/mx.ts";

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-import-"));
  db = openDb(path.join(dir, "app.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function csvFile(name: string, content: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

function newList(excludeRoles = true): number {
  return createList(db, { name: "L", sourceLabel: "src", consentText: "consented", excludeRoles });
}

function contacts(listId: number): { email: string; domain: string; fields: Record<string, string> }[] {
  const rows = db
    .prepare("SELECT email, domain, fields_json FROM contacts WHERE list_id = ? ORDER BY id")
    .all(listId) as { email: string; domain: string; fields_json: string }[];
  return rows.map((r) => ({ email: r.email, domain: r.domain, fields: JSON.parse(r.fields_json) }));
}

function run(filePath: string, listId: number, extra: Partial<ImportOptions> = {}) {
  return streamImport({ filePath, db, listId, excludeRoles: true, ...extra });
}

const okChecker = async (): Promise<DomainStatus> => "ok";

const MIXED = [
  "\uFEFFemail,first_name,notes",
  'Jo@Example.com,Jo,"likes cats, dogs"',
  "jo@example.com,Joanne,dup",
  '"Smith, Jane <jane@example.org>",Jane,"quoted, comma"',
  "info@example.com,Info,role",
  "not-an-email,Bad,invalid",
  "bob@sample.org,Bob,",
  "",
  " BOB@sample.org , Bobby , again",
  "",
].join("\r\n");

describe("streamImport — mixed file (BOM, CRLF, quotes, extra columns)", () => {
  it("returns exact counts and the email column", async () => {
    const listId = newList();
    const result = await run(csvFile("mixed.csv", MIXED), listId, { domainChecker: okChecker });
    expect(result).toEqual({
      totalRows: 7,
      valid: 3,
      invalid: 1,
      duplicate: 2,
      suppressed: 0,
      role: 1,
      emailColumn: "email",
    });
  });

  it("stores normalized emails, domains and the other columns as fields_json", async () => {
    const listId = newList();
    await run(csvFile("mixed.csv", MIXED), listId, { domainChecker: okChecker });
    expect(contacts(listId)).toEqual([
      { email: "jo@example.com", domain: "example.com", fields: { first_name: "Jo", notes: "likes cats, dogs" } },
      { email: "jane@example.org", domain: "example.org", fields: { first_name: "Jane", notes: "quoted, comma" } },
      { email: "bob@sample.org", domain: "sample.org", fields: { first_name: "Bob", notes: "" } },
    ]);
    expect(getListColumns(db, listId)).toEqual(["first_name", "notes"]);
  });

  it("marks the list ready with counts and the email column", async () => {
    const listId = newList();
    await run(csvFile("mixed.csv", MIXED), listId);
    expect(getList(db, listId)).toMatchObject({
      status: "ready",
      email_column: "email",
      total_rows: 7,
      valid_count: 3,
      invalid_count: 1,
      duplicate_count: 2,
      suppressed_count: 0,
      role_count: 1,
      error: null,
    });
  });
});

describe("streamImport — shapes", () => {
  it("imports a headerless single-column file, treating row 1 as data", async () => {
    const listId = newList();
    const result = await run(csvFile("plain.csv", "a@x.com\nb@y.com\nA@X.com\n"), listId);
    expect(result).toMatchObject({ totalRows: 3, valid: 2, duplicate: 1, emailColumn: "column_1" });
    expect(contacts(listId)).toEqual([
      { email: "a@x.com", domain: "x.com", fields: {} },
      { email: "b@y.com", domain: "y.com", fields: {} },
    ]);
  });

  it("names headerless columns column_1..n", async () => {
    const listId = newList();
    const result = await run(csvFile("h.csv", "Jo,jo@x.com,Paris\nAl,al@y.com,Rome\n"), listId);
    expect(result).toMatchObject({ totalRows: 2, valid: 2, emailColumn: "column_2" });
    expect(contacts(listId)[0].fields).toEqual({ column_1: "Jo", column_3: "Paris" });
  });

  it("imports a semicolon-delimited file", async () => {
    const listId = newList();
    const result = await run(csvFile("semi.csv", 'Name;E-Mail\n"Smith; Jo";jo@x.com\nAl;al@y.com\n'), listId);
    expect(result).toMatchObject({ totalRows: 2, valid: 2, emailColumn: "E-Mail" });
    expect(contacts(listId)[0].fields).toEqual({ Name: "Smith; Jo" });
  });

  it("imports a tab-delimited file", async () => {
    const listId = newList();
    const result = await run(csvFile("tab.tsv", "first\temail\nJo\tjo@x.com\n"), listId);
    expect(result).toMatchObject({ valid: 1, emailColumn: "email" });
  });

  it("detects the email column from first-row content when no header matches", async () => {
    const listId = newList();
    const result = await run(csvFile("c.csv", "who,addr\nJo,jo@x.com\nAl,al@y.com\n"), listId);
    expect(result).toMatchObject({ valid: 2, emailColumn: "addr" });
  });

  it("names blank headers column_<i> and suffixes duplicates", async () => {
    const listId = newList();
    await run(csvFile("d.csv", "email,name,name,,name_2\njo@x.com,A,B,C,D\n"), listId);
    expect(contacts(listId)[0].fields).toEqual({ name: "A", name_2: "B", column_4: "C", name_2_2: "D" });
  });

  it("fills missing cells with empty strings and ignores cells beyond the header", async () => {
    const listId = newList();
    await run(csvFile("r.csv", "email,first,last\njo@x.com,Jo\nal@y.com,Al,Lee,extra\n"), listId);
    expect(contacts(listId).map((c) => c.fields)).toEqual([
      { first: "Jo", last: "" },
      { first: "Al", last: "Lee" },
    ]);
  });

  it("handles a header-only file", async () => {
    const listId = newList();
    const result = await run(csvFile("e.csv", "email,first_name\n"), listId);
    expect(result).toEqual({ totalRows: 0, valid: 0, invalid: 0, duplicate: 0, suppressed: 0, role: 0, emailColumn: "email" });
    expect(getList(db, listId)!.status).toBe("ready");
  });
});

describe("streamImport — compliance filters", () => {
  it("drops suppressed addresses, counting them as suppressed even when they are role addresses", async () => {
    addSuppression(db, "jo@x.com", "unsubscribe");
    addSuppression(db, "info@x.com", "manual");
    const listId = newList();
    const result = await run(csvFile("s.csv", "email\nJO@x.com\ninfo@x.com\nal@y.com\n"), listId);
    expect(result).toMatchObject({ totalRows: 3, valid: 1, suppressed: 2, role: 0 });
    expect(contacts(listId).map((c) => c.email)).toEqual(["al@y.com"]);
  });

  it("keeps role addresses when excludeRoles is false, counting them in role and valid", async () => {
    const listId = newList(false);
    const result = await run(csvFile("r.csv", "email\ninfo@x.com\njo@x.com\nINFO@x.com\n"), listId, { excludeRoles: false });
    expect(result).toMatchObject({ totalRows: 3, valid: 2, role: 1, duplicate: 1 });
    expect(contacts(listId).map((c) => c.email)).toEqual(["info@x.com", "jo@x.com"]);
  });

  it("dedupes only within the list", async () => {
    const one = newList();
    const two = newList();
    const file = csvFile("x.csv", "email\njo@x.com\n");
    await run(file, one);
    const result = await run(file, two);
    expect(result).toMatchObject({ valid: 1, duplicate: 0 });
  });
});

describe("streamImport — email column override", () => {
  const TWO = "work,personal,name\njo@work.com,jo@home.com,Jo\n";

  it("defaults to the first email-looking column", async () => {
    const listId = newList();
    expect((await run(csvFile("t.csv", TWO), listId)).emailColumn).toBe("work");
  });

  it("accepts a header name", async () => {
    const listId = newList();
    const result = await run(csvFile("t.csv", TWO), listId, { emailColumn: "personal" });
    expect(result.emailColumn).toBe("personal");
    expect(contacts(listId)).toEqual([
      { email: "jo@home.com", domain: "home.com", fields: { work: "jo@work.com", name: "Jo" } },
    ]);
  });

  it("accepts a 0-based index", async () => {
    const listId = newList();
    const result = await run(csvFile("t.csv", TWO), listId, { emailColumn: 1 });
    expect(result.emailColumn).toBe("personal");
    expect(contacts(listId)[0].email).toBe("jo@home.com");
  });

  it("rejects an unknown header name and marks the list failed", async () => {
    const listId = newList();
    await expect(run(csvFile("t.csv", TWO), listId, { emailColumn: "nope" })).rejects.toThrow(/nope/);
    expect(getList(db, listId)!.status).toBe("failed");
  });

  it("rejects an out-of-range index and marks the list failed", async () => {
    const listId = newList();
    await expect(run(csvFile("t.csv", TWO), listId, { emailColumn: 7 })).rejects.toThrow(Error);
    expect(getList(db, listId)!.status).toBe("failed");
  });
});

describe("streamImport — failures", () => {
  it("throws 'No email column found; choose one' and marks the list failed", async () => {
    const listId = newList();
    await expect(run(csvFile("n.csv", "name,city\nJo,Paris\n"), listId)).rejects.toThrow(
      "No email column found; choose one",
    );
    expect(getList(db, listId)).toMatchObject({ status: "failed", error: "No email column found; choose one" });
    expect(contacts(listId)).toEqual([]);
  });

  it("rejects a malformed file (unclosed quote beyond max_record_size) without hanging", async () => {
    const listId = newList();
    const file = csvFile("bad.csv", `email\n"jo@x.com,${"x".repeat(1_200_000)}\nal@y.com\n`);
    const started = Date.now();
    await expect(run(file, listId)).rejects.toThrow(/max record size/i);
    expect(Date.now() - started).toBeLessThan(10_000);
    const list = getList(db, listId)!;
    expect(list.status).toBe("failed");
    expect(list.error).toMatch(/max record size/i);
    expect(list.error).not.toMatch(/\n/);
  });

  it("keeps contacts committed in earlier batches when a later row is malformed", async () => {
    const listId = newList();
    const good = Array.from({ length: 1500 }, (_, i) => `u${i}@x.com`).join("\n");
    const file = csvFile("partial.csv", `email\n${good}\n"broken,${"x".repeat(1_100_000)}\n`);
    await expect(run(file, listId)).rejects.toThrow(Error);
    const n = (db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE list_id = ?").get(listId) as { n: number }).n;
    expect(n).toBeGreaterThanOrEqual(1000);
    expect(n).toBeLessThanOrEqual(1500);
    expect(getList(db, listId)!.status).toBe("failed");
  });

  it("rejects a missing file and marks the list failed", async () => {
    const listId = newList();
    await expect(run(path.join(dir, "missing.csv"), listId)).rejects.toThrow(/ENOENT|no such file/i);
    expect(getList(db, listId)!.status).toBe("failed");
  });

  it("rejects an empty file and marks the list failed", async () => {
    const listId = newList();
    await expect(run(csvFile("empty.csv", ""), listId)).rejects.toThrow(Error);
    expect(getList(db, listId)!.status).toBe("failed");
  });

  it("rejects an unknown list id", async () => {
    await expect(run(csvFile("x.csv", "email\njo@x.com\n"), 424242)).rejects.toThrow(/list/i);
  });
});

describe("streamImport — re-import into an existing list", () => {
  it("resets a previously failed list and ends ready with fresh counts and no stale error", async () => {
    const listId = newList();
    await expect(run(csvFile("n.csv", "name,city\nJo,Paris\n"), listId)).rejects.toThrow(Error);
    db.prepare(
      `UPDATE lists SET total_rows = 99, valid_count = 99, invalid_count = 99, duplicate_count = 99,
        suppressed_count = 99, role_count = 99 WHERE id = ?`,
    ).run(listId);

    const result = await run(csvFile("ok.csv", "email\njo@x.com\nbad\n"), listId);

    expect(result).toMatchObject({ totalRows: 2, valid: 1, invalid: 1 });
    expect(getList(db, listId)).toMatchObject({
      status: "ready",
      error: null,
      total_rows: 2,
      valid_count: 1,
      invalid_count: 1,
      duplicate_count: 0,
      suppressed_count: 0,
      role_count: 0,
    });
  });

  it("marks the list importing with cleared error and zeroed counts while it runs", async () => {
    const listId = newList();
    db.prepare("UPDATE lists SET status = 'failed', error = 'old', valid_count = 7, total_rows = 7 WHERE id = ?").run(listId);
    const rows = Array.from({ length: 1000 }, (_, i) => `u${i}@x.com`).join("\n");
    let during: unknown;
    await run(csvFile("p.csv", `email\n${rows}\n`), listId, {
      onProgress: () => {
        during ??= getList(db, listId);
      },
    });
    expect(during).toMatchObject({ status: "importing", error: null, valid_count: 0, total_rows: 0 });
  });
});

describe("streamImport — progress", () => {
  it("reports parsing progress every 1000 rows and at the end", async () => {
    const listId = newList();
    const rows = Array.from({ length: 2500 }, (_, i) => `u${i}@x.com`).join("\n");
    const seen: ImportProgress[] = [];
    await run(csvFile("p.csv", `email\n${rows}\n`), listId, { onProgress: (p) => seen.push({ ...p }) });
    expect(seen.map((p) => [p.phase, p.rowsProcessed])).toEqual([
      ["parsing", 1000],
      ["parsing", 2000],
      ["parsing", 2500],
    ]);
  });
});

describe("streamImport — domain phase", () => {
  const STATUSES: Record<string, DomainStatus> = { "good.com": "ok", "bad.com": "invalid", "slow.com": "unknown" };
  const checker = async (d: string): Promise<DomainStatus> => STATUSES[d] ?? "ok";
  const FILE = "email,first\na@good.com,A\nb@bad.com,B\nc@BAD.com,C\nd@slow.com,D\ninfo@bad.com,I\n";

  it("deletes contacts on invalid domains, keeps unknown, and moves them from valid to invalid", async () => {
    const listId = newList();
    const result = await run(csvFile("dom.csv", FILE), listId, { domainChecker: checker });
    expect(result).toMatchObject({ totalRows: 5, valid: 2, invalid: 2, role: 1 });
    expect(contacts(listId).map((c) => c.email)).toEqual(["a@good.com", "d@slow.com"]);
    expect(getList(db, listId)).toMatchObject({ status: "ready", valid_count: 2, invalid_count: 2 });
  });

  it("removes deleted role addresses from the role count when roles are kept", async () => {
    const listId = newList(false);
    const result = await run(csvFile("dom.csv", FILE), listId, { domainChecker: checker, excludeRoles: false });
    expect(result).toMatchObject({ totalRows: 5, valid: 2, invalid: 3, role: 0 });
  });

  it("checks each distinct domain once and reports domain progress", async () => {
    const listId = newList();
    const checked: string[] = [];
    const seen: ImportProgress[] = [];
    await run(csvFile("dom.csv", FILE), listId, {
      domainChecker: async (d) => {
        checked.push(d);
        return checker(d);
      },
      onProgress: (p) => seen.push({ ...p }),
    });
    expect(checked.sort()).toEqual(["bad.com", "good.com", "slow.com"]);
    const domainEvents = seen.filter((p) => p.phase === "checking_domains");
    expect(domainEvents.at(-1)).toEqual({
      phase: "checking_domains",
      rowsProcessed: 5,
      domainsChecked: 3,
      domainsTotal: 3,
      breakerTripped: false,
    });
  });

  it("keeps every contact and reports breakerTripped when DNS is down", async () => {
    const listId = newList();
    const emails = Array.from({ length: 60 }, (_, i) => `u${i}@d${i}.com`);
    const seen: ImportProgress[] = [];
    let calls = 0;
    const result = await run(csvFile("down.csv", `email\n${emails.join("\n")}\n`), listId, {
      domainChecker: async () => {
        calls++;
        return "unknown";
      },
      onProgress: (p) => seen.push({ ...p }),
    });
    expect(result).toMatchObject({ totalRows: 60, valid: 60, invalid: 0 });
    expect(calls).toBeLessThan(60);
    expect(contacts(listId)).toHaveLength(60);
    expect(seen.at(-1)).toMatchObject({ phase: "checking_domains", domainsChecked: 60, domainsTotal: 60, breakerTripped: true });
    expect(getList(db, listId)!.status).toBe("ready");
  });

  it("skips the domain phase when no checker is given", async () => {
    const listId = newList();
    const seen: ImportProgress[] = [];
    const result = await run(csvFile("dom.csv", FILE), listId, { onProgress: (p) => seen.push(p) });
    expect(result).toMatchObject({ valid: 4, invalid: 0 });
    expect(seen.some((p) => p.phase === "checking_domains")).toBe(false);
  });
});
