# MamaDirect HTTP API

Request schemas (zod 4) and response types live in `server/http/contract.ts`; import types from there rather than redeclaring them. The contract below is binding; "Implementation notes (10A)" at the end records what the implementation adds or clarifies. One contract change: `CampaignView.schedule` is nullable (see "Status and health").

## Conventions
- All API routes are under `/api`, JSON in/out unless stated. Errors: HTTP 4xx/5xx with body `{ "error": { "code": string, "message": string, "details"?: unknown } }`. Validation errors: 400, code `invalid_request`, details = zod issues.
- Security (enforced by a Fastify onRequest hook in 10A):
  - Host header must be `127.0.0.1:<port>`, `localhost:<port>`, or `[::1]:<port>` → else 403 `bad_host` (DNS-rebinding guard).
  - For non-GET/HEAD: `Origin` (if present) must be `http://127.0.0.1:<port>` / `http://localhost:<port>` / `http://[::1]:<port>` (or the Vite dev origin from env `MAMADIRECT_DEV_ORIGIN`) → else 403 `bad_origin`; and header `X-MamaDirect: 1` must be present → else 403 `missing_header` (forces a CORS preflight for any cross-site attempt; the server never answers CORS).
  - Every `/api/*` route except `GET /api/session` requires cookie `md_session` equal to the per-process random token (32 bytes hex, generated at boot) → else 401 `no_session`. Cookie: `HttpOnly; SameSite=Strict; Path=/`. Compare in constant time.
  - The cookie is set by `GET /api/session` (204) and when serving `index.html`.
- Secrets (SMTP password, UNSUB_SECRET, session token) never appear in any response body or log.
- Server-Sent Events: `GET /api/events` (`text/event-stream`), comment ping every 15 s. Event names: `worker` (WorkerEvent from server/send/worker.ts), `import` (ImportEvent), `status` (StatusSnapshot, sent on connect and on every worker status event), `health` (Health, on change).

## Types (in contract.ts)
```ts
type HealthItem = { status: "ok" | "fail" | "unknown"; detail: string; checkedAt: string | null };
type Health = { smtp: HealthItem; dns: HealthItem; network: HealthItem; worker: HealthItem & { heartbeatAgeMs: number | null; loopRunning: boolean } };
type SettingsView = { fromName: string; fromEmail: string; replyTo: string | null; postalAddress: string; unsubMailbox: string; publicBaseUrl: string | null; dkimSelector: string | null; timezone: string; testInboxes: string[]; smtp: { host: string; port: number; secure: boolean; user: string; passSet: boolean } };
type ImportEvent = { listId: number; phase: "parsing" | "checking_domains" | "done" | "failed"; rowsProcessed?: number; domainsChecked?: number; domainsTotal?: number; breakerTripped?: boolean; counts?: ImportCounts; error?: string };
type CampaignCounts = { pending: number; sending: number; sent: number; retry: number; failed: number; uncertain: number; skipped_suppressed: number; total: number };
type CampaignView = { id; listId; templateId; templateVersion; status; pauseReason: string | null; schedule: Schedule | null; createdAt; startedAt; finishedAt; counts: CampaignCounts; estimate: Estimate; stats: { sentLastHour: number; rejectionRate: number; sample: number } };
type StatusSnapshot = { campaign: CampaignView | null; worker: { status: string | null; heartbeatAgeMs: number | null; loopRunning: boolean; inFlight: boolean } };
type Gate = { key: "list_ready" | "has_recipients" | "from_email" | "postal_address" | "unsub_mailbox" | "smtp_verified" | "dns_ok" | "variables_resolved" | "no_malformed_tags" | "links_ok" | "test_send_ok" | "schedule_valid"; ok: boolean; message: string };
```

## Routes — 10A
| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | /api/session | — | 204, sets cookie |
| GET | /api/health | — | Health |
| GET | /api/status | — | StatusSnapshot |
| GET | /api/events | — | SSE stream |
| GET | /api/settings | — | SettingsView |
| PUT | /api/settings | partial SettingsView fields + `smtp.pass?: string` (write-only) + `smtp.clearPass?: true` | SettingsView |
| POST | /api/settings/smtp/test | — | `{ ok: boolean; message: string }` (updates Health.smtp) |
| POST | /api/settings/dns/check | — (uses fromEmail's domain + dkimSelector) | `{ domain; ok; spf: {ok, record: string \| null, detail}; dkim: {ok, selector: string \| null, detail}; dmarc: {ok, record: string \| null, detail} }` (updates Health.dns) |
| GET | /api/lists | — | ListRow[] |
| POST | /api/lists/preview | multipart `file` (only the first 64 KiB is read) | `{ delimiter; headers: string[]; headerless: boolean; rows: string[][] (≤5); emailColumn: number }` |
| POST | /api/lists | multipart `file` + fields `name`, `sourceLabel`, `consentText`, `consentConfirmed` ("true" required), `excludeRoles` ("true"/"false", default true), `emailColumn?` (name, or `#<index>`), `checkDomains` (default "true") | 202 `{ listId }`; import continues in background; progress via SSE `import` |
| GET | /api/lists/:id | — | ListRow & { columns: string[] } |
| DELETE | /api/lists/:id | — | 204 (409 `in_use` if a campaign references it) |
| GET | /api/suppression | `search?, limit (≤1000, default 100), offset` | `{ rows; total }` |
| POST | /api/suppression | `{ email, reason?: "manual" }` | 201 `{ added: boolean }` |
| DELETE | /api/suppression/:email | — | 204 |
| GET | /api/suppression/export | — | `text/csv` download `email,reason,created_at` |
| GET/POST | /u/:token | (public-safe, NOT under /api, no session/header checks; Host check relaxed only on the public listener) | GET: HTML page with a "Confirm unsubscribe" button (GET never mutates — link scanners prefetch). POST (form or `List-Unsubscribe=One-Click`): add suppression `unsubscribe`, HTML confirmation. Invalid token → 400 HTML. |

## Routes — 10B
| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | /api/templates | — | TemplateSummary[] `{id,name,version,updatedAt}` |
| POST | /api/templates | JSON `{name, subject, html?, text?}` (≥1 of html/text) or multipart `file` (.html/.htm/.txt) + `name`, `subject` | TemplateView |
| GET | /api/templates/:id | — | TemplateView = row fields + `variableMap` + `analysis: { variables: TemplateVariable[]; malformed: {part, problems}[]; validation: {ok, unresolved, needsFallback}; hasComplianceTags: boolean }` + `linkCheck: LinkCheck \| null` + `testedOk: boolean` |
| PUT | /api/templates/:id | `{name?, subject?, html?, text?, variableMap?}` | TemplateView (version+1 when subject/html/text/variableMap change; clears linkCheck when html/text change; testedOk false until a new test send) |
| DELETE | /api/templates/:id | — | 204 / 409 `in_use` |
| POST | /api/templates/:id/preview | `{ listId?: number; pick?: "first" \| "next" \| "random"; afterContactId?: number }` | `{ contactId: number \| null; email; subject; html; text }` (synthetic contact `jane.doe@example.com` when no list) |
| POST | /api/templates/:id/link-check | — | LinkCheck `{ version; checkedAt; links: { url; ok; status: number \| null; finalUrl: string \| null; error: string \| null; acknowledged: boolean }[] }` |
| POST | /api/templates/:id/link-ack | `{ url }` | LinkCheck |
| POST | /api/templates/:id/test-send | `{ to?: string[] }` (must be a subset of settings.testInboxes; default all) | `{ results: { to; ok; messageId: string \| null; error: string \| null }[] }` (all ok → testedOk for this version) |
| POST | /api/estimate | `{ remaining: number; schedule: Schedule }` | Estimate |
| GET | /api/campaigns | — | CampaignView[] |
| POST | /api/campaigns | `{ listId, templateId, schedule }` | 201 CampaignView (status draft; one sends row per contact) |
| GET | /api/campaigns/:id | — | CampaignView |
| PUT | /api/campaigns/:id/schedule | `{ schedule }` (draft/paused only) | CampaignView |
| GET | /api/campaigns/:id/gates | — | `{ ok: boolean; gates: Gate[] }` |
| POST | /api/campaigns/:id/start | — | CampaignView (409 `gates_failed` with gates in details) |
| POST | /api/campaigns/:id/pause \| resume \| stop | — | CampaignView |
| GET | /api/campaigns/:id/uncertain | `limit, offset` | `{ rows: {contactId, email, lastError, updatedAt}[]; total }` |
| POST | /api/campaigns/:id/requeue | `{ contactIds?: number[] }` | `{ requeued: number }` |
| GET | /api/campaigns/:id/events | `type?, limit (≤500), beforeId?` | `{ rows: {id,type,message,createdAt}[] }` |
| DELETE | /api/campaigns/:id | draft/completed/stopped only | 204 |

## Implementation notes (10A)

### Security
- The guard runs as a root `onRequest` hook, so it covers static files, the SPA fallback and unmatched paths (a foreign Host gets 403 `bad_host` even on a 404 path). Routes are classified by the matched route pattern, not the raw URL: only the `/u/:token` route skips the Origin/header/session checks, and any path that starts with `/api` (case-insensitive, percent-decoded) needs the session even when no route matches.
- Rejected requests get `Connection: close`, so a refused multi-GB upload is not read.
- Every response also carries `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'` (anti-clickjacking: the Host check alone does not stop another site framing `http://127.0.0.1:<port>`), `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`; `/api/*` responses are `Cache-Control: no-store`.
- Vite dev proxy: use `changeOrigin: true` so the Host header arriving here is `127.0.0.1:<port>`; set `MAMADIRECT_DEV_ORIGIN` to the Vite origin (for example `http://localhost:5173`).
- A JSON request with `Content-Type: application/json` and an empty body is treated as no body (so clients may always send that header). `__proto__`/`constructor` keys are rejected.
- 500 responses never include the error message or stack; details go to `data/logs/app.log` with secrets redacted.

### Additional error codes
| Status | Code | When |
|---|---|---|
| 400 | `file_missing` | multipart request without a `file` part |
| 400 | `empty_file`, `unparseable` | list preview could not read the file |
| 400 | `from_email_missing` | DNS check before a from address is set |
| 400 | `bad_request` | any other malformed request |
| 404 | `not_found` | unknown route or id |
| 409 | `import_running` | DELETE of a list whose import is still running |
| 413 | `body_too_large`, `file_too_large`, `too_many_files`, `too_many_fields` | limits (JSON 1 MiB, upload 2 GiB, 1 file, 20 fields) |
| 415 | `unsupported_media_type` | wrong content type (lists routes need multipart) |
| 500 | `internal` | unexpected server error |
| 507 | `disk_full` | ENOSPC while writing |

### SSE (`GET /api/events`)
- On connect the stream sends `retry: 2000`, then a `status` event and a `health` event (the contract requires `status` on connect; `health` is extra so a reconnecting client is immediately current).
- `health` is also published when the worker reports a status change. `import` progress for the domain-check phase is throttled to one event per 250 ms (the final one always goes out).
- A client that stops reading is dropped once more than 8 MiB is buffered for it. `EventHub.closeAll()` ends every stream (graceful shutdown calls it before `app.close()`).

### Status and health
- `CampaignView.schedule` is `null` when the stored schedule JSON is unreadable; `estimate` is then empty with a `perDayCapacityNote` asking to set the schedule again. A corrupt row never breaks `/api/status` or SSE connects.
- `HEAD /api/events` is not routed (404); only GET opens a stream.
- `StatusSnapshot.campaign` is the worker's current campaign (after a restart, the most recent active or held campaign is adopted), or `null`. `estimate` covers pending + retry + sending rows; `stats.sentLastHour` counts `sent` events in the last hour; `rejectionRate`/`sample` use the last 200 sent/failed/suppressed outcomes.
- `Health.worker.checkedAt` is the time of the request. Worker status is `fail` when an active campaign's loop is not running, a send has been in flight longer than the send timeout + 30 s, or the loop has been silent longer than max(60 s, 3 × delay + 60 s) past its expected wake time; otherwise `ok`.
- `Health.network` is `unknown` until an SMTP host is set; otherwise a DNS lookup of the SMTP host (5 s cap), refreshed at most every 60 s (or immediately when the host changes) when `GET /api/health` is called.

### Settings
- `fromEmail` and `unsubMailbox` accept `""` (not set). `replyTo`, `publicBaseUrl` and `dkimSelector` accept `null` or `""` (cleared). Emails are lowercased/trimmed and must not contain whitespace or any of `< > ? , ; : " ( ) [ ] \`.
- `publicBaseUrl` is stored without a trailing slash and with commas percent-encoded. The app serves `/u/:token` at the root of whichever listener receives it, so the tunnel must map `publicBaseUrl` to the listener root (strip any path prefix).
- Unknown keys are rejected (400). `smtp.passSet` is accepted and ignored, so a client may send a `SettingsView` back unchanged.
- `smtp.pass` must be 1–1024 characters without line breaks and representable in `.env`; it is written with `setEnvValue` (temp file + rename, mode 0600), registered for log redaction, and never stored in the database or returned.
- `POST /api/settings/smtp/test` returns `{ ok: false }` with a "enter the … first" message, without touching `Health.smtp`, when host, user or password is missing. The whole test is capped at 45 s.
- `POST /api/settings/dns/check` returns `DnsCheckResult` (see `server/dns/check.ts`). `Health.dns.detail` summarizes the failing parts.

### Lists
- Multipart field order is free (fields may follow the file). The file part must be named `file`. The upload is written to `data/uploads/incoming-<random>.csv`, renamed to `<listId>-<random>.csv` once the fields validate, and deleted when the import ends (success or failure) or when the request is refused.
- `emailColumn`: `#<n>` is a 0-based column index; anything else is a header name.
- `POST /api/lists/preview` reads only the first 64 KiB but drains the rest of the upload; clients should send `file.slice(0, 65536)`.
- `ListRow` is the database row type from `server/import/lists.ts` (snake_case). `GET /api/lists/:id` `columns` lists the extra CSV columns (not the email column).
- On boot, lists left in `importing` by a crash are marked `failed` ("upload the file again") and `data/uploads/` is emptied.

### Suppression
- `DELETE /api/suppression/:email` is idempotent (204 even if the address was not listed).
- The CSV export prefixes cells that start with `= + - @`, tab or CR with `'` (spreadsheet formula injection).

### Unsubscribe
- Tokens up to 1024 characters are accepted (the router's parameter limit is raised to 2048).
- Pages are served with `Cache-Control: no-store` and a strict CSP (`default-src 'none'; form-action 'self'`). The confirmation form posts to its own URL, so it works behind a tunnel.
- POST accepts any body up to 16 KiB (urlencoded, multipart, or none). An address that is already suppressed keeps its original reason.
- The public listener (`MAMADIRECT_PUBLIC_PORT`) has no Host check and answers 404 to everything except `GET/POST /u/:token`; it never sets the session cookie.

### Boot and runtime files
- The lock is taken right after the data directories exist and before `.env` secrets are generated, so two simultaneous first starts cannot write different `UNSUB_SECRET`s.
- The lock file is created with its content in one step (temp file + hard link), so it is never seen half-written. A stale lock is renamed aside, re-checked, and deleted only if it is still the file judged stale (otherwise it is put back), so two racing starts end with exactly one owner. An unreadable lock younger than 2 s counts as "starting".
- `data/mamadirect.lock` (`{ pid, port, startedAt }`): a second start prints `MamaDirect is already running at http://127.0.0.1:<port>` and exits 0 when the holder is alive and answers `GET /api/session`, or "already starting" (exit 0) during its first 60 s. A lock whose pid is dead, whose `startedAt` predates the last reboot, or that is unreadable is taken over. A live holder that does not answer after 60 s is not taken over (two senders on one database could duplicate mail): the second start prints how to recover and exits 1.
- `data/server.json` (`{ pid, port, url }`) is written once listening and removed on exit.
- Env: `PORT` (default 5199, next free port if busy), `MAMADIRECT_DATA_DIR`, `MAMADIRECT_ENV_FILE` (path to `.env`), `MAMADIRECT_NO_OPEN=1`, `MAMADIRECT_PUBLIC_PORT`, `MAMADIRECT_DEV_ORIGIN`.
