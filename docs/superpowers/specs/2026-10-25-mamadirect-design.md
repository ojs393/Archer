# MamaDirect — Design Spec

**Date:** 2026-10-25
**Status:** Draft — awaiting user review

## 1. Purpose

MamaDirect is a local, single-page web app that sends one email at a time to every address in a (potentially very large) CSV list, through a user-configured SMTP provider, from a dedicated sending domain. It must be compliant (CAN-SPAM baseline), self-healing, resumable, secure, and runnable on any machine with Node.js.

### Non-goals (explicitly out of scope)

- Domain/IP rotation or any technique intended to evade spam filters.
- Open/click tracking pixels or link rewriting.
- Hosting the dashboard on the public internet.
- Automatic processing of asynchronous bounces/complaints (v1 shows only synchronous SMTP rejections; async bounces are viewed in the provider dashboard). Candidate for v2 via IMAP.

## 2. Compliance rules (enforced by the tool)

1. Every email contains a working unsubscribe mechanism and the sender's postal address (PO box / virtual mailbox acceptable). Launch is blocked until a postal address is set.
2. A global suppression list (unsubscribes, permanent failures, manual adds) is checked at import time and again immediately before each send.
3. Each list import requires a source label and an explicit consent attestation checkbox; the attestation text, timestamp, and source are stored with the list.
4. Role addresses (`info@`, `sales@`, `admin@`, `support@`, `noreply@`, `postmaster@`, `abuse@`, `webmaster@`, `contact@`, `hello@`, `office@`) are excluded by default (toggle per list).
5. Automatic safety stop when synchronous rejections exceed 5% of the last 200 attempts (minimum sample: 50).
6. Headers: `List-Unsubscribe` always (mailto). When an HTTPS tunnel URL is configured, also an HTTPS URL plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). The dashboard warns when the daily cap exceeds 5,000 without HTTPS one-click unsubscribe (Gmail/Yahoo bulk-sender requirement).
7. Real sending is locked until: SMTP connection test passed, DNS checks (SPF, DKIM, DMARC) pass for the from-domain, all template variables resolve, link check passes, and at least one test send succeeded for the current template version.

## 3. Architecture

Single Node.js runtime (>= 22.13, required for built-in `node:sqlite`). No native/compiled dependencies.

```
mamadirect/
  package.json            root scripts: setup, start, dev, test, test:e2e, doctor
  server/
    index.ts              boot: config, db, http, worker, watchdog
    supervisor.ts         spawns server, restarts on crash with backoff
    config.ts             paths resolved from project root (import.meta.url); env overrides
    db/                   node:sqlite wrapper, migrations, integrity check, backups
    http/                 Fastify routes + SSE event stream + security middleware
    import/               streaming CSV parse, validation, dedupe, MX cache
    template/             variable detection, rendering, escaping, plain-text gen, link check
    send/                 worker loop, SMTP transport (nodemailer), error classifier, scheduler
    watchdog/             heartbeat monitor, stall recovery, network probe
    dns/                  SPF/DKIM/DMARC checks
    unsubscribe/          signed tokens, mailto handling, public unsubscribe route
  web/                    Vite + React 18 + TS strict, Elevar UI system
  scripts/
    doctor.mjs            environment checks + auto-repair
    setup.mjs             full setup + self-test
  tests/                  unit, integration (fake SMTP), e2e (Playwright)
  data/                   runtime only, git-ignored: mamadirect.db, uploads/, logs/, backups/
  .env                    runtime only, git-ignored, mode 0600
```

### Key dependencies

| Purpose | Package |
|---|---|
| HTTP server | `fastify` |
| Validation | `zod` |
| SMTP | `nodemailer` |
| CSV streaming | `csv-parse` |
| HTML → text | `html-to-text` |
| Fake SMTP (tests) | `smtp-server` |
| Tests | `vitest`, `@playwright/test` |
| Frontend | `react`, `vite`, `tailwindcss@3`, Radix/shadcn components copied from Elevar, `lucide-react`, `sonner`, `react-hook-form`, `@tanstack/react-query` |

Server TypeScript runs via `tsx` in dev; `npm start` runs a prebuilt bundle (built automatically if missing or stale).

## 4. Data model (SQLite, WAL mode)

- `settings` — key/value (non-secret config: from name/address, reply-to, postal address, timezone, tunnel URL, test inboxes).
- `lists` — id, name, source_label, consent_text, consent_at, created_at, counts (valid, invalid, duplicate, suppressed, role).
- `contacts` — id, list_id, email (lowercased), domain, fields_json (extra CSV columns), UNIQUE(list_id, email).
- `suppression` — email (PK), reason (`unsubscribe` | `hard_bounce` | `manual` | `complaint`), created_at.
- `templates` — id, name, version, subject, html, text, variable_map_json, link_check_json, last_test_ok_version.
- `campaigns` — id, list_id, template_id, template_version, status (`draft` | `running` | `paused` | `waiting_window` | `waiting_network` | `safety_stop` | `completed` | `stopped`), pause_reason, schedule_json, created_at, started_at.
- `sends` — campaign_id, contact_id, state (`pending` | `sending` | `sent` | `retry` | `failed` | `uncertain` | `skipped_suppressed`), attempts, next_attempt_at, last_error, smtp_response, message_id, updated_at. PK(campaign_id, contact_id); index on (campaign_id, state, next_attempt_at).
- `events` — id, campaign_id, type, message, created_at (ring-trimmed to last 50,000).

Every state transition is a single committed transaction before the next step.

## 5. Send flow

1. **Import:** upload streams to `data/uploads/`, then parsed row-by-row with `csv-parse`. Email column auto-detected (header named `email`/`e-mail`/`Email Address`, else first column whose values look like emails; user can override). Handles BOM, CRLF, quoted fields, and extra columns (become template variables). Validation: syntax check, lowercase/trim, dedupe within list, suppression check, role-address flag, MX lookup per unique domain (cached, 5s timeout, concurrency 10; domains with no MX/A are marked invalid). Inserts in batches of 1,000 inside transactions. Progress pushed via SSE.
2. **Campaign:** choose list, template, schedule. Creating a campaign inserts one `sends` row per eligible contact (batched).
3. **Test send:** renders the template for a sample contact (or a synthetic one) and sends only to configured test inboxes. Marks `last_test_ok_version`.
4. **Run loop** (one email at a time):
   - If outside the send window or today's quota is used → status `waiting_window`, sleep until next window start.
   - Select next row: state `pending`, or `retry` with `next_attempt_at <= now`.
   - Re-check suppression → `skipped_suppressed` if present.
   - Mark `sending` (commit) → render → send via SMTP → mark `sent` with message_id (commit), or classify error.
   - Sleep the inter-send delay (with ±20% jitter).
5. **Resume on boot:** rows found in `sending` are moved to `uncertain` (never auto-resent). The dashboard lists them with a manual "requeue" action.

### Error classification

| Condition | Action |
|---|---|
| Network error / timeout / `421`, `450`, `451`, `452` / `4xx` | `retry`, backoff 30s, 2m, 10m, 30m, 2h (±20% jitter); after 5 attempts → `failed` |
| `550`, `551`, `553`, `5.1.x` (mailbox/address) | `failed` + add to suppression (`hard_bounce`) |
| Other `5xx` for a recipient | `failed` (not suppressed) |
| `535` / auth failure | Pause campaign (`paused`, reason `auth_failed`), alert |
| DNS resolution of SMTP host fails | Campaign → `waiting_network`, probe every 15s, resume automatically |

### Schedule and estimate

- Settings: send days, start/end time, IANA timezone (defaults to browser timezone), daily cap, warm-up enabled, inter-send delay (seconds).
- Default warm-up: day 1 = 50, doubling each send-day until the daily cap (default cap 2,000).
- Effective per-day volume = min(warm-up quota, daily cap, window_seconds / delay).
- The estimate is a pure function of (remaining count, schedule, start date) returning a per-day table and completion date; DST-safe via timezone-aware date math.

## 6. Templates and variables

- Upload `.html` / `.txt` or edit in-app. Subject is templated.
- Syntax: `{{name}}` or `{{name | fallback}}`. Whitespace inside braces ignored. Unknown/malformed tags are reported.
- Built-in variables: `email`, `first_name`, `domain`, `unsubscribe_url`, `postal_address`, `today`.
- Variable map: each detected variable maps to a CSV column, a built-in, or a fixed value. Sending is blocked if any variable lacks both a source and a fallback.
- `first_name` resolution order: CSV `first_name` column → first token of CSV `name` column → `guessFirstName(email)` → fallback.
- `guessFirstName(email)`: returns a capitalized first name only for clear patterns like `first.last` / `first_last` / `first-last` with alphabetic parts of length 2–20; returns null for role addresses, digits, single tokens, or ambiguous forms. (User-authored core logic, with tests.)
- All CSV-derived values are HTML-escaped in the HTML part. CR/LF stripped from subject and header values.
- Plain-text part generated from HTML when not supplied.
- Compliance footer auto-appended unless the template contains both `{{unsubscribe_url}}` and `{{postal_address}}`.
- Link check: extracts every `href`/URL, issues HEAD (fallback GET) with 10s timeout; reports status, final URL after redirects; non-2xx blocks launch until fixed or explicitly acknowledged per-link.

## 7. Dashboard (single page)

Visual system follows Elevar: light mode, primary `#10b981`, accent `#059669`, background `#f8fafc`, cards `bg-white border border-slate-200 rounded-xl shadow-sm`, shadcn/ui components, lucide icons, sonner toasts.

- **Top bar:** status pill; health lights for SMTP, DNS, network, worker heartbeat (each opens a diagnostic dialog with fix steps); Start / Pause / Resume / Stop (Stop uses AlertDialog confirm).
- **Step 1 Sender:** SMTP form (host, port, secure mode, user, password-write-only) + Test connection; from name/address, reply-to, unsubscribe mailbox, postal address, optional tunnel URL; DNS check dialog with exact records and re-check.
- **Step 2 List:** CSV upload with progress; result counts; email-column override; source label + consent attestation; role-address toggle; suppression manager dialog (search, add, remove, export CSV).
- **Step 3 Template:** upload/edit; variable mapping table with status badges; link check results; recipient preview with next/random.
- **Step 4 Schedule:** days, hours, timezone, daily cap, warm-up, delay; live estimate with per-day table and completion date.
- **Step 5 Test & Launch:** test inbox list + Send test; launch checklist (all gates from §2.7); launch confirmation dialog summarizing recipients, schedule, and estimate.
- **Live panel:** progress bar; counts by state; rate/hour; rejection rate; ETA; filterable event log; uncertain list with requeue.
- Live updates via Server-Sent Events (`/api/events`), auto-reconnecting with backoff; the UI shows a "reconnecting" banner when the stream drops.

## 8. Security

- Server binds to `127.0.0.1` only.
- Host header must be `localhost`/`127.0.0.1` with the active port (DNS-rebinding defense); `Origin` must match on all non-GET requests.
- A session token (random, generated per server start) is set as an `HttpOnly; SameSite=Strict` cookie on page load and required on every `/api` call.
- Secrets (`SMTP_PASS`, `UNSUB_SECRET`) live in `.env` (mode 0600, created by setup with `crypto.randomBytes`). SMTP password is write-only from the UI and redacted from logs and error messages.
- SMTP requires TLS (implicit or STARTTLS with `requireTLS`); plaintext auth refused.
- Unsubscribe tokens: `base64url(contact_email) + "." + HMAC-SHA256(UNSUB_SECRET, email)`; constant-time compare.
- Optional public exposure (Cloudflare Tunnel) is served by a separate listener that exposes only `GET/POST /u/:token`.
- zod validation on every route; upload size limit 2 GB, streamed; JSON body limit 1 MB.
- Lockfile committed; doctor runs `npm audit --audit-level=high` and reports.

## 9. Self-healing

- Timeouts: SMTP connect 15s, greeting 15s, socket 60s; MX lookup 5s; link check 10s.
- Worker heartbeat every 5s. Watchdog stall threshold = max(60s, 3 × delay + 60s). On stall: close and rebuild the SMTP transport, restart the loop. Three recoveries within 10 minutes → pause with reason `watchdog_giveup`.
- Sleep/wake: a timer-drift check (> 30s jump) triggers a schedule recompute and transport rebuild.
- Supervisor restarts the server process on crash with backoff (1s, 2s, 5s, 10s, max 30s); five crashes within 5 minutes → stop and print the last error.
- Graceful shutdown on SIGINT/SIGTERM: finish or abort the in-flight send cleanly, commit state.
- DB: `PRAGMA integrity_check` at boot (on failure, restore the newest backup and log it); daily backup to `data/backups/`, keep 7.

## 10. Setup and doctor

- `npm run setup`: Node >= 22.13 check (if missing, print OS-specific install command; Node is not auto-installed) → `npm ci` with 10-minute timeout and 2 retries → create `data/` tree → create `.env` with generated secrets if absent (never overwrite) → run migrations → `npm audit` (report only) → self-test (full send to in-process fake SMTP) → print URL.
- `npm start`: quick doctor (deps present, `.env` present, data dirs, DB integrity); auto-repairs what it can (runs install, creates dirs, restores DB backup), builds the web/server bundle if stale, starts the supervisor, prints and opens the URL.
- Port: `PORT` env or 5199; if busy, next free port.
- All paths derive from the project root resolved via `import.meta.url`; `MAMADIRECT_DATA_DIR` overrides the data location.

## 11. Testing

- **Unit (vitest):** CSV parsing (BOM, CRLF, quotes, extra columns, header detection, 1M-row stream memory bound), email validation, role detection, template variable detection/rendering/escaping/fallbacks, `guessFirstName`, plain-text generation, schedule/estimate (windows, DST transitions, warm-up), error classifier, unsubscribe token sign/verify, Host/Origin guard.
- **Integration (vitest + `smtp-server`):** full campaign happy path; transient errors → retries; permanent errors → suppression; auth failure → pause; unresponsive server → watchdog recovery; process killed mid-send → resume with zero duplicates and `uncertain` handling; safety stop threshold.
- **E2E (Playwright):** every button and dialog on the dashboard against fake SMTP; SSE live updates reflected in the UI.
- **Manual pre-launch:** test sends to the user's own Gmail, Outlook, and iCloud inboxes; one send to mail-tester.com.

## 12. Build order

1. Project scaffold, config, doctor/setup, DB + migrations.
2. Template engine + CSV import (with tests).
3. Send worker, error classifier, scheduler, watchdog, supervisor (with fake-SMTP integration tests).
4. HTTP API, security middleware, SSE, unsubscribe.
5. Dashboard UI (Elevar components) wired to the API.
6. E2E tests, manual test-send checklist.
