import fs from "node:fs";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openDb } from "../../server/db/index.ts";
import { streamImport } from "../../server/import/csv.ts";
import { createList, getList } from "../../server/import/lists.ts";

const ROWS = 1_000_000;
const MB = 1024 * 1024;

let dir: string;
let db: DatabaseSync;

async function writeLargeCsv(file: string): Promise<void> {
  const out = fs.createWriteStream(file);
  out.write("email,first_name,city\n");
  for (let i = 0; i < ROWS; i++) {
    const line = `user${i}@domain${i % 500}.example.com,Name${i},"City, ${i % 97}"\n`;
    if (!out.write(line)) await once(out, "drain");
  }
  out.end();
  await once(out, "finish");
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mamadirect-large-"));
  db = openDb(path.join(dir, "app.db"));
});

afterAll(() => {
  db?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

it(
  `imports ${ROWS.toLocaleString("en-US")} rows with bounded heap growth`,
  async () => {
    const file = path.join(dir, "large.csv");
    await writeLargeCsv(file);
    const listId = createList(db, { name: "big", sourceLabel: "gen", consentText: "ok", excludeRoles: true });

    const baseline = process.memoryUsage().heapUsed;
    let peak = baseline;
    const started = Date.now();
    const result = await streamImport({
      filePath: file,
      db,
      listId,
      excludeRoles: true,
      domainChecker: null,
      onProgress: () => {
        peak = Math.max(peak, process.memoryUsage().heapUsed);
      },
    });
    const elapsedMs = Date.now() - started;
    const growthMb = (peak - baseline) / MB;
    console.log(
      `[import-large] rows=${ROWS} elapsed=${(elapsedMs / 1000).toFixed(1)}s heapGrowthPeak=${growthMb.toFixed(1)}MB file=${(fs.statSync(file).size / MB).toFixed(1)}MB`,
    );

    expect(result).toEqual({
      totalRows: ROWS,
      valid: ROWS,
      invalid: 0,
      duplicate: 0,
      suppressed: 0,
      role: 0,
      emailColumn: "email",
    });
    expect(getList(db, listId)!.valid_count).toBe(ROWS);
    expect(growthMb).toBeLessThan(150);
  },
  180_000,
);
