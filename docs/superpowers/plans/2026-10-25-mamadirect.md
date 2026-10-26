# MamaDirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local single-page web app that sends one compliant email at a time to every address in a large CSV, with live progress, self-healing, and resume.

**Architecture:** One Node.js runtime (>= 22.13, built-in `node:sqlite`). A Fastify server on `127.0.0.1` runs the HTTP API, an SSE event stream, a background send worker, and a watchdog. A Vite + React single page (Elevar's UI system) drives it. All state is in local SQLite; progress is committed after every send so a crash resumes with no duplicates.

**Tech Stack:** Node 22, TypeScript 5, Fastify 5, `node:sqlite`, nodemailer 10, csv-parse 7, html-to-text 10, zod 3, vitest 4, smtp-server 3 (tests only), Vite + React 18 + Tailwind 3 + shadcn/ui, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-mamadirect-design.md`

## Global Constraints

- Node engine floor: `>=22.13.0`. Required for `node:sqlite` (`DatabaseSync`).
- No native/compiled dependencies anywhere. Pure-JS only.
- No hardcoded absolute paths. All paths derive from the project root via `import.meta.url`; `MAMADIRECT_DATA_DIR` overrides the data location; `PORT` overrides the port (default 5199, fall forward to next free port).
- Server binds `127.0.0.1` only. Dashboard is never exposed publicly; only the unsubscribe route may be exposed via an optional separate listener.
- Secrets live in `.env` at the project root, mode `0600`, created with `crypto.randomBytes`, never overwritten, never returned to the browser, redacted from logs.
- Every send-state transition is committed before the next step. Rows left in `sending` on boot become `uncertain` (never auto-resent).
- Compliance is enforced in code: unsubscribe mechanism + postal address in every email; suppression checked at import and immediately before each send; launch gated on connection test + DNS + variable resolution + link check + one successful test send.
- No open/click tracking. No domain/IP rotation. These are out of scope by design.
- UI follows Elevar: light mode, primary `#10b981`, accent `#059669`, background `#f8fafc`, cards `bg-white border border-slate-200 rounded-xl shadow-sm`, shadcn/ui, lucide-react, sonner.
- All source TypeScript. Server code uses ESM (`"type": "module"`). Tests colocated under `tests/` run by vitest.

---

## File Structure

```
package.json              root scripts + deps
tsconfig.json             shared TS base
tsconfig.server.json      server build (outDir dist/server)
vitest.config.ts          unit + integration test runner
playwright.config.ts      e2e
.env.example              documents env vars (committed)
scripts/
  doctor.mjs              env checks + auto-repair
  setup.mjs               full setup + self-test
server/
  config.ts               paths, port, env load, constants
  logger.ts               redacting logger
  db/
    index.ts              DatabaseSync open, pragmas, integrity, backup
    migrate.ts            schema migrations
  domain/
    email.ts              validateEmail, isRoleAddress, normalizeEmail
    guessName.ts          guessFirstName (USER-AUTHORED core)
    template.ts           detectVariables, renderTemplate, escapeHtml, resolveFirstName
    htmlToText.ts         plain-text generation wrapper
    schedule.ts           estimateSchedule, nextSendTime, warmupQuota
    classifyError.ts      classifySmtpError
    unsubscribe.ts        signToken, verifyToken
  import/
    csv.ts               streamImport (csv-parse), column detection
    mx.ts                 hasMailExchanger (cached)
  send/
    transport.ts         buildTransport (nodemailer), verify
    worker.ts            SendWorker: loop, pause/resume, safety stop
    watchdog.ts          Watchdog: heartbeat, stall recovery, network probe
  http/
    server.ts            Fastify instance, security hooks, static, SSE
    routes/*.ts          settings, lists, templates, campaigns, suppression, unsubscribe, test
    events.ts            SSE broadcaster
  index.ts               boot: config -> db -> http -> worker -> watchdog
  supervisor.ts          spawn index, restart on crash with backoff
web/
  (Vite React app; mirrors Elevar src/components/ui + lib/utils)
tests/
  unit/*.test.ts
  integration/*.test.ts
  fakeSmtp.ts            smtp-server harness with fault injection
e2e/
  dashboard.spec.ts
```

---

### Task 1: Project scaffold, config, and the doctor/setup scripts

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.server.json`, `.env.example`, `vitest.config.ts`
- Create: `server/config.ts`, `server/logger.ts`
- Create: `scripts/doctor.mjs`, `scripts/setup.mjs`
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Produces: `config` object `{ root: string, dataDir: string, dbPath: string, uploadsDir: string, logsDir: string, backupsDir: string, port: number, env: Record<string,string> }`; `loadEnv(): void`; `ensureDataDirs(): void`; `getFreePort(preferred: number): Promise<number>`.
- Produces: `logger` with `info/warn/error` that redact any value equal to a known secret.

- [ ] **Step 1: Write failing test for path resolution**

```ts
// tests/unit/config.test.ts
import { describe, it, expect } from "vitest";
import { resolvePaths } from "../../server/config.ts";

describe("resolvePaths", () => {
  it("derives data dir from project root, not cwd", () => {
    const p = resolvePaths({ root: "/proj", env: {} });
    expect(p.dataDir).toBe("/proj/data");
    expect(p.dbPath).toBe("/proj/data/mamadirect.db");
  });
  it("honors MAMADIRECT_DATA_DIR override", () => {
    const p = resolvePaths({ root: "/proj", env: { MAMADIRECT_DATA_DIR: "/custom" } });
    expect(p.dataDir).toBe("/custom");
    expect(p.dbPath).toBe("/custom/mamadirect.db");
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — `npx vitest run tests/unit/config.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement `server/config.ts`**

```ts
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import net from "node:net";
import crypto from "node:crypto";

export function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function resolvePaths({ root, env }: { root: string; env: NodeJS.ProcessEnv }) {
  const dataDir = env.MAMADIRECT_DATA_DIR
    ? path.resolve(env.MAMADIRECT_DATA_DIR)
    : path.join(root, "data");
  return {
    root,
    dataDir,
    dbPath: path.join(dataDir, "mamadirect.db"),
    uploadsDir: path.join(dataDir, "uploads"),
    logsDir: path.join(dataDir, "logs"),
    backupsDir: path.join(dataDir, "backups"),
    envPath: path.join(root, ".env"),
  };
}

export function ensureDataDirs(p = resolvePaths({ root: projectRoot(), env: process.env })) {
  for (const d of [p.dataDir, p.uploadsDir, p.logsDir, p.backupsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export function loadEnv(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
    if (m) process.env[m[1]] ??= m[2];
  }
  return out;
}

export function ensureSecrets(envPath: string): void {
  const existing = loadEnv(envPath);
  const needed = ["UNSUB_SECRET", "SESSION_SECRET"];
  const missing = needed.filter((k) => !existing[k]);
  if (missing.length === 0) return;
  const lines = missing.map((k) => `${k}=${crypto.randomBytes(32).toString("hex")}`);
  fs.appendFileSync(envPath, (fs.existsSync(envPath) ? "\n" : "") + lines.join("\n") + "\n");
  fs.chmodSync(envPath, 0o600);
}

export async function getFreePort(preferred: number): Promise<number> {
  const tryPort = (port: number) =>
    new Promise<number | null>((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(null));
      s.once("listening", () => s.close(() => resolve(port)));
      s.listen(port, "127.0.0.1");
    });
  for (let port = preferred; port < preferred + 50; port++) {
    const ok = await tryPort(port);
    if (ok) return ok;
  }
  throw new Error(`No free port near ${preferred}`);
}

export const config = (() => {
  const root = projectRoot();
  const p = resolvePaths({ root, env: process.env });
  return { ...p, port: Number(process.env.PORT) || 5199 };
})();
```

- [ ] **Step 4: Run test, verify pass** — `npx vitest run tests/unit/config.test.ts` → PASS.

- [ ] **Step 5: Implement `server/logger.ts`** — a small wrapper that holds a set of secret strings (registered at boot) and replaces each occurrence with `***` in any logged string/arg before writing to stdout and to `data/logs/app.log`.

- [ ] **Step 6: Write `package.json`** with:

```jsonc
{
  "name": "mamadirect",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.13.0" },
  "scripts": {
    "setup": "node scripts/setup.mjs",
    "doctor": "node scripts/doctor.mjs",
    "start": "node scripts/doctor.mjs --quick && node --import tsx server/supervisor.ts",
    "dev": "node --import tsx server/index.ts",
    "build:web": "vite build",
    "build:server": "tsc -p tsconfig.server.json",
    "test": "vitest run tests/unit tests/integration",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@fastify/cookie": "11.1.3",
    "@fastify/multipart": "10.1.6",
    "@fastify/static": "10.1.7",
    "csv-parse": "7.0.3",
    "fastify": "5.12.7",
    "html-to-text": "10.0.1",
    "nodemailer": "10.2.1",
    "zod": "3.25.76"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "@types/html-to-text": "9.0.4",
    "@types/node": "22.16.5",
    "@types/nodemailer": "8.0.2",
    "@types/smtp-server": "3.5.13",
    "smtp-server": "3.21.1",
    "tsx": "4.23.15",
    "typescript": "5.9.3",
    "vitest": "4.1.12"
  }
}
```

(Web deps — react, vite, tailwind, radix, etc. — are added in Task 11.)

- [ ] **Step 7: Write `tsconfig.json` / `tsconfig.server.json`** — base targets ES2022, module NodeNext, `allowImportingTsExtensions` for tsx dev; server build config emits to `dist/server`.

- [ ] **Step 8: Write `.env.example`** documenting `PORT`, `MAMADIRECT_DATA_DIR`, `UNSUB_SECRET`, `SESSION_SECRET`, `SMTP_PASS` (with a note that setup generates the secrets).

- [ ] **Step 9: Write `scripts/doctor.mjs`** — checks: Node `>=22.13` (else print OS-specific install hint from `process.platform`: `brew install node` / `winget install OpenJS.NodeJS.LTS` / `nvm install 22`); `node_modules` present (else `--quick` runs `npm ci`); data dirs (create if missing); `.env` secrets (call `ensureSecrets`); DB integrity (if DB exists). Each check prints `PASS`/`FAIL`/`FIXED`. Exits non-zero only on unfixable failure. `--quick` flag skips `npm audit` and self-test.

- [ ] **Step 10: Write `scripts/setup.mjs`** — runs doctor's full checks, then `npm ci` with a 10-minute timeout and 2 retries (spawn, kill on timeout), `npm audit --audit-level=high` (report only, never fail), then invokes the self-test (filled in Task 10). Prints a final summary and the start command.

- [ ] **Step 11: Commit** — `git add -A && git commit -m "feat: scaffold, config, doctor/setup"`.

---

### Task 2: Database layer and migrations

**Files:**
- Create: `server/db/index.ts`, `server/db/migrate.ts`
- Test: `tests/unit/db.test.ts`

**Interfaces:**
- Produces: `openDb(path: string): DatabaseSync` (sets `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`); `runMigrations(db): void`; `checkIntegrity(db): boolean`; `backup(db, dir): string`; `restoreLatest(dir, dbPath): boolean`.
- Produces: the full schema from spec §4 (`settings`, `lists`, `contacts`, `suppression`, `templates`, `campaigns`, `sends`, `events`) with the stated indexes.

- [ ] **Step 1: Write failing test** — open an in-memory db, run migrations, assert all 8 tables exist (`SELECT name FROM sqlite_master WHERE type='table'`), assert `sends` PK is composite, assert inserting a duplicate `(list_id,email)` into `contacts` throws.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `server/db/index.ts` and `migrate.ts`** — `DatabaseSync` from `node:sqlite`; migrations as an ordered array of SQL strings tracked in a `schema_migrations(version)` table; `checkIntegrity` runs `PRAGMA integrity_check` and returns whether result is `ok`; `backup` copies the db file (checkpoint WAL first) to `backups/mamadirect-<ISO>.db`, prunes to 7 newest; `restoreLatest` copies the newest backup over the db path.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `feat: sqlite layer + migrations`.

---

### Task 3: Email validation and role detection

**Files:**
- Create: `server/domain/email.ts`
- Test: `tests/unit/email.test.ts`

**Interfaces:**
- Produces: `normalizeEmail(raw: string): string` (trim + lowercase); `isValidEmail(email: string): boolean`; `emailDomain(email: string): string`; `isRoleAddress(email: string): boolean` (local-part in the spec §2.4 set).

- [ ] **Step 1: Write failing tests** — valid/invalid addresses (`a@b.co` ok; `foo`, `a@`, `a@b`, `a b@c.com`, embedded `\n` all invalid); `normalizeEmail(" A@B.CO ") === "a@b.co"`; `isRoleAddress("info@x.com")` true, `isRoleAddress("john@x.com")` false.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — pragmatic regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) plus explicit rejection of control chars; role set as a `Set`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `feat: email validation + role detection`.

---

### Task 4: Name guessing (USER-AUTHORED core logic)

**Files:**
- Create: `server/domain/guessName.ts`
- Test: `tests/unit/guessName.test.ts`

**Interfaces:**
- Produces: `guessFirstName(email: string): string | null` — capitalized first name for clear `first.last` / `first_last` / `first-last` patterns (alphabetic parts length 2–20); `null` for role addresses, digit-containing local parts, single tokens, or ambiguous forms.

- [ ] **Step 1: Write the failing test** (full table, provided here):

```ts
// tests/unit/guessName.test.ts
import { describe, it, expect } from "vitest";
import { guessFirstName } from "../../server/domain/guessName.ts";

describe("guessFirstName", () => {
  const cases: [string, string | null][] = [
    ["john.smith@x.com", "John"],
    ["john_smith@x.com", "John"],
    ["john-smith@x.com", "John"],
    ["JANE.DOE@x.com", "Jane"],
    ["info@x.com", null],
    ["sales@x.com", null],
    ["jsmith84@x.com", null],
    ["jsmith@x.com", null],
    ["a.b@x.com", null],        // too short
    ["john2.smith@x.com", null], // digits
  ];
  for (const [email, expected] of cases) {
    it(`${email} -> ${expected}`, () => expect(guessFirstName(email)).toBe(expected));
  }
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/unit/guessName.test.ts`.

- [ ] **Step 3: USER WRITES the implementation.** Create `server/domain/guessName.ts` with the signature and a clear TODO. Ask the user to fill ~8 lines: given `email`, take the local part, bail to `null` on role addresses (reuse `isRoleAddress`) or any digit, split on the first `.`/`_`/`-`, take the first segment, require length 2–20 and all-alphabetic, then capitalize. This is a judgment call about their audience, so they own it.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `feat: first-name guessing`.

---

### Task 5: Template engine

**Files:**
- Create: `server/domain/template.ts`, `server/domain/htmlToText.ts`
- Test: `tests/unit/template.test.ts`

**Interfaces:**
- Produces: `detectVariables(text: string): { name: string; fallback: string | null }[]` (dedupe by name); `escapeHtml(s: string): string`; `renderTemplate(src: string, values: Record<string,string>, opts: { escape: boolean }): string`; `renderEmail(template, contact, settings): { subject, html, text }` which resolves built-ins (`email`, `first_name` via resolution order, `domain`, `unsubscribe_url`, `postal_address`, `today`), applies the variable map, escapes CSV-derived values in HTML, strips CR/LF from subject, appends the compliance footer when missing, and generates text from html via `htmlToText`.
- Produces: `validateVariableMap(vars, map): { ok: boolean; unresolved: string[] }`.

- [ ] **Step 1: Write failing tests** — `detectVariables("Hi {{first_name | there}} <{{email}}>")` → two entries with correct fallbacks; `escapeHtml("<b>&")` → `&lt;b&gt;&amp;`; `renderTemplate("Hi {{n}}", {n:"<x>"}, {escape:true})` escapes; fallback used when value missing; subject with `\n` has newline stripped; footer auto-appended when `{{unsubscribe_url}}` absent.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.** Variable regex `/\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g`. `renderEmail` composes the pieces; `htmlToText.ts` wraps `html-to-text` with sane options (no images, keep links as `(url)`).

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `feat: template engine`.

---

### Task 6: Schedule and estimate

**Files:**
- Create: `server/domain/schedule.ts`
- Test: `tests/unit/schedule.test.ts`

**Interfaces:**
- Produces: `warmupQuota(dayIndex: number, cap: number, warmup: boolean): number` (day 0 → 50, doubling, capped; `warmup:false` → cap); `estimateSchedule(input): { perDay: { date: string; count: number }[]; completionDate: string; totalDays: number }` where `input = { remaining, startDate, timezone, sendDays: number[], startHour, endHour, dailyCap, warmup, delaySeconds }`; `nextSendTime(now, schedule): Date` (next instant inside an allowed window, timezone-aware).

- [ ] **Step 1: Write failing tests** — warmup sequence `[50,100,200,...,cap]`; an estimate for 1000 remaining with cap 2000/no warmup and a 5-day week completes in expected days; `nextSendTime` on a Friday evening with Mon–Fri window returns Monday start; a DST-transition week still yields correct window boundaries (use a fixed IANA zone like `America/New_York`).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** using `Intl.DateTimeFormat` with `timeZone` for timezone-aware date parts (no external date lib). Per-day volume = `min(warmupQuota, dailyCap, floor(windowSeconds / delaySeconds))`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `feat: schedule + estimate`.

---

### Task 7: SMTP error classifier and unsubscribe tokens

**Files:**
- Create: `server/domain/classifyError.ts`, `server/domain/unsubscribe.ts`
- Test: `tests/unit/classifyError.test.ts`, `tests/unit/unsubscribe.test.ts`

**Interfaces:**
- Produces: `classifySmtpError(err): { kind: "retry" | "suppress" | "fail" | "auth" | "network"; }` per spec §5 table (reads `err.responseCode`/`err.code`).
- Produces: `signToken(email: string, secret: string): string`; `verifyToken(token: string, secret: string): string | null` (returns email or null; constant-time compare).

- [ ] **Step 1: Write failing tests** — `{responseCode:451}`→retry; `{responseCode:550}`→suppress; `{responseCode:535}`→auth; `{code:"ECONNRESET"}`→network; `{responseCode:502}`→fail. Token round-trips; a tampered token returns null.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — classifier maps codes/ranges; tokens are `base64url(email) + "." + HMAC-SHA256`, verified with `crypto.timingSafeEqual`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `feat: error classifier + unsub tokens`.

---

### Task 8: CSV streaming import and MX check

**Files:**
- Create: `server/import/csv.ts`, `server/import/mx.ts`
- Test: `tests/unit/csv.test.ts`, `tests/integration/import.test.ts`

**Interfaces:**
- Produces: `detectEmailColumn(headers: string[], firstRow: string[]): number`; `streamImport(opts): Promise<ImportResult>` where `opts = { filePath, db, listId, emailColumnIndex?, excludeRoles, onProgress }` and `ImportResult = { valid, invalid, duplicate, suppressed, role }`. Reads with `csv-parse` as a stream, inserts contacts in batches of 1000 inside transactions, checks suppression + dedupe, stores extra columns as `fields_json`.
- Produces: `hasMailExchanger(domain: string): Promise<boolean>` (cached Map; `dns.promises.resolveMx` with 5s timeout; falls back to `resolve` A record; failures → false).

- [ ] **Step 1: Write failing unit tests for `detectEmailColumn`** — header named `Email`/`e-mail`/`Email Address` chosen; else the column whose first-row value matches an email.

- [ ] **Step 2: Run, verify fail. Step 3: Implement detection. Step 4: pass.**

- [ ] **Step 5: Write integration test** — write a temp CSV with BOM, CRLF, quoted fields with commas, an extra `first_name` column, duplicates, one role address, one invalid row; run `streamImport` against a real in-memory db (MX stubbed to true); assert the `ImportResult` counts and that `fields_json` holds `first_name`.

- [ ] **Step 6: Implement `streamImport` + `mx.ts`.** Use `createReadStream().pipe(parse({ bom:true, columns:true, relax_quotes:true, skip_empty_lines:true }))`. Accumulate batches; flush in a transaction. Progress callback every 1000 rows.

- [ ] **Step 7: Run, verify pass. Step 8: Commit** — `feat: CSV import + MX`.

---

### Task 9: SMTP transport, send worker, watchdog, supervisor

**Files:**
- Create: `server/send/transport.ts`, `server/send/worker.ts`, `server/send/watchdog.ts`, `server/supervisor.ts`
- Create: `tests/fakeSmtp.ts`
- Test: `tests/integration/worker.test.ts`

**Interfaces:**
- Produces: `buildTransport(cfg): Transporter` (nodemailer; `requireTLS:true`, refuses plaintext auth); `verifyTransport(cfg): Promise<void>`.
- Produces: `class SendWorker { constructor(db, deps); start(campaignId): void; pause(reason): void; resume(): void; stop(): void; getHeartbeat(): number; on(event, cb) }` — the one-at-a-time loop with window checks, suppression recheck, state commits, inter-send delay + jitter, retry backoff, safety stop (>5% rejections over last 200, min 50), and `uncertain` recovery on boot.
- Produces: `class Watchdog { constructor(worker, deps); start(); stop() }` — stall detection (threshold `max(60s, 3*delay+60s)`), transport rebuild, 3-recoveries-in-10-min → pause; network probe loop for `waiting_network`.
- Produces: `tests/fakeSmtp.ts` → `startFakeSmtp(opts): { port, close, setBehavior(fn) }` using `smtp-server`, able to inject: accept, `4xx`, `5xx`, auth-fail, hang (never respond), and drop.

- [ ] **Step 1: Write `tests/fakeSmtp.ts`** harness first (no assertions; a tool).

- [ ] **Step 2: Write failing integration tests** against fake SMTP:
  - happy path: 5 contacts all become `sent`, events emitted;
  - transient: server returns `451` twice then accepts → row ends `sent` with ≥2 attempts;
  - permanent: `550` → row `failed` and email in `suppression`;
  - auth fail: `535` → campaign `paused` reason `auth_failed`;
  - watchdog: server hangs → worker stalls → watchdog rebuilds → completes;
  - resume: kill the worker mid-batch (simulate by setting a row to `sending` then constructing a new worker) → that row becomes `uncertain`, not resent; remaining complete;
  - safety stop: feed >5% `550` over the window → campaign `safety_stop`.

- [ ] **Step 3: Run, verify fail. Step 4: Implement transport, worker, watchdog. Step 5: verify pass.**

- [ ] **Step 6: Implement `supervisor.ts`** — spawns `server/index.ts` via tsx as a child, restarts on non-zero exit with backoff (1,2,5,10,30s), 5 crashes in 5 min → give up and print last error. (Manually smoke-tested, not unit-tested.)

- [ ] **Step 7: Commit** — `feat: send worker, watchdog, supervisor`.

---

### Task 10: HTTP API, security, SSE, unsubscribe route, and the self-test

**Files:**
- Create: `server/http/server.ts`, `server/http/events.ts`, `server/http/routes/{settings,lists,templates,campaigns,suppression,test,unsubscribe}.ts`, `server/dns/check.ts`, `server/index.ts`
- Test: `tests/integration/http.test.ts`, `tests/integration/selftest.test.ts`

**Interfaces:**
- Produces: a Fastify app bound to `127.0.0.1` with hooks enforcing Host allow-list (DNS-rebinding guard), Origin check on non-GET, and a per-start session cookie (`HttpOnly; SameSite=Strict`) required on `/api/*`. Routes implement spec §7 operations. `GET /api/events` is the SSE stream. `GET/POST /u/:token` is the unsubscribe handler (also mountable on a separate public listener). `checkDns(domain): Promise<{spf,dkim,dmarc}>`.
- Produces: `server/index.ts` boot sequence; and `runSelfTest(): Promise<void>` that starts a fake SMTP server, imports a 3-row in-memory list, renders a template, runs a mini-campaign to completion, and asserts all `sent` — called by `scripts/setup.mjs`.

- [ ] **Step 1: Write failing security tests** — request with a foreign `Host` header → 403; POST with mismatched `Origin` → 403; `/api/*` without the session cookie → 401; unsubscribe with a valid token adds to suppression and returns a confirmation page; invalid token → 400.

- [ ] **Step 2: Run, verify fail. Step 3: Implement server + hooks + routes + SSE + dns + index. Step 4: verify pass.**

- [ ] **Step 5: Write `runSelfTest` + `tests/integration/selftest.test.ts`**, wire it into `scripts/setup.mjs`; run `npm run setup` end-to-end and confirm the self-test passes.

- [ ] **Step 6: Commit** — `feat: http api, security, sse, unsubscribe, self-test`.

---

### Task 11: Dashboard (Elevar UI) — scaffold and shared components

**Files:**
- Create: `web/` Vite React app; `vite.config.ts` (proxy `/api` + `/u` to the server, build to `dist/web`); copy `web/src/components/ui/*` and `web/src/lib/utils.ts` from Elevar (`button`, `card`, `dialog`, `alert-dialog`, `input`, `label`, `select`, `switch`, `badge`, `progress`, `tabs`, `tooltip`, `sonner`/toast); `web/src/index.css` + `tailwind.config.ts` with Elevar's emerald tokens.
- Create: `web/src/lib/api.ts` (typed fetch wrapper sending the session cookie), `web/src/lib/useEventStream.ts` (SSE hook with auto-reconnect + "reconnecting" banner state).
- Test: `tests/unit/api.test.ts` (url building, error shape).

**Interfaces:**
- Produces: `api.get/post/upload` helpers; `useEventStream(): { connected, lastEvent }`; the shared shadcn components under `web/src/components/ui/`.

- [ ] **Step 1: Add web deps** (react 18, react-dom, vite, @vitejs/plugin-react-swc, tailwindcss 3, postcss, autoprefixer, the Radix packages used, class-variance-authority, clsx, tailwind-merge, lucide-react, sonner, @tanstack/react-query, react-hook-form, zod) to `package.json`.

- [ ] **Step 2: Copy UI primitives + tokens from Elevar** (`/Users/oliversmith/Documents/Elevar/src/components/ui/*`, `src/lib/utils.ts`, `tailwind.config.ts`, `src/index.css`) and trim to what's used. Verify `vite build` succeeds.

- [ ] **Step 3: Write failing `api.test.ts`; implement `api.ts` + `useEventStream.ts`; verify pass.**

- [ ] **Step 4: Commit** — `feat: web scaffold + shared UI`.

---

### Task 12: Dashboard screens wired to the API

**Files:**
- Create: `web/src/App.tsx`, `web/src/components/TopBar.tsx`, `HealthLights.tsx`, and step cards `SenderStep.tsx`, `ListStep.tsx`, `TemplateStep.tsx`, `ScheduleStep.tsx`, `LaunchStep.tsx`, plus `LivePanel.tsx`, `SuppressionDialog.tsx`, `VariableMap.tsx`, `EstimateTable.tsx`, `Preview.tsx`.
- Test: covered by e2e in Task 13.

**Interfaces:**
- Consumes: all `/api` routes from Task 10 and `useEventStream` from Task 11.

- [ ] **Step 1: Build the top bar** — status pill, four health lights (each opens a diagnostic `Dialog` with fix steps from the health endpoint), Start/Pause/Resume/Stop (Stop uses `AlertDialog`). Wire to `/api/campaign/status` + SSE.

- [ ] **Step 2: Sender step** — SMTP form + Test connection; from/reply-to/postal/unsub mailbox; DNS check dialog showing exact records + re-check. Green check when connection + DNS pass.

- [ ] **Step 3: List step** — upload with progress (SSE), result counts, email-column override, source label + consent attestation checkbox (required), role toggle, suppression dialog (search/add/remove/export).

- [ ] **Step 4: Template step** — upload/edit, `VariableMap` with red/green badges, link check results, `Preview` with next/random recipient.

- [ ] **Step 5: Schedule step** — days/hours/timezone/cap/warmup/delay, live `EstimateTable` recomputing on change.

- [ ] **Step 6: Launch step** — test inbox list + Send test; launch checklist reflecting all gates; confirmation `AlertDialog` summarizing recipients + schedule + ETA; disabled until gates pass.

- [ ] **Step 7: Live panel** — progress bar, per-state counts, rate/hour, rejection rate, ETA, filterable event log, uncertain list with requeue. All numbers have tooltips.

- [ ] **Step 8: Commit after each step** — `feat(web): <step>`.

---

### Task 13: End-to-end tests and the manual pre-launch checklist

**Files:**
- Create: `playwright.config.ts`, `e2e/dashboard.spec.ts`
- Create: `docs/PRELAUNCH.md` (manual checklist)

**Interfaces:**
- Consumes: the full app started against a fake SMTP server.

- [ ] **Step 1: Write `playwright.config.ts`** — `webServer` launches the app with `MAMADIRECT_DATA_DIR` pointed at a temp dir and an env flag that makes the server use the in-process fake SMTP; `baseURL` from the chosen port.

- [ ] **Step 2: Write `e2e/dashboard.spec.ts`** — walk the whole flow: configure sender (fake), upload a small CSV, upload a template and map variables, set a schedule, send a test, launch, and watch the live panel reach completion via SSE. Assert every dialog opens and every primary button works.

- [ ] **Step 3: Run `npm run test:e2e`, verify pass.**

- [ ] **Step 4: Write `docs/PRELAUNCH.md`** — the manual steps: real SMTP creds, verify DNS, send to own Gmail/Outlook/iCloud, run one send to mail-tester.com, interpret the score.

- [ ] **Step 5: Commit** — `test: e2e + prelaunch checklist`.

---

## Self-Review

**Spec coverage:** §2 compliance → Tasks 5 (footer), 8 (suppression at import), 9 (suppress on bounce, safety stop), 10 (unsubscribe, launch gates). §3 architecture → Tasks 1,2,9,10. §4 data model → Task 2. §5 send flow/errors/schedule → Tasks 6,7,8,9. §6 templates → Tasks 4,5. §7 dashboard → Tasks 11,12. §8 security → Tasks 1 (secrets),10 (hooks/tokens). §9 self-healing → Tasks 2 (integrity/backup),9 (worker/watchdog/supervisor). §10 setup/doctor → Task 1,10 (self-test). §11 testing → every task + Task 13. No gaps found.

**Placeholder scan:** The only intentional "USER WRITES" step is Task 4 (name guessing), which is a deliberate learning-mode contribution with full tests already specified — not a plan gap. No TBD/TODO/"handle edge cases" elsewhere.

**Type consistency:** `ImportResult`, `SendWorker` methods, `classifySmtpError` kinds, `signToken/verifyToken`, and schedule function names are used consistently across Tasks 6–12.
