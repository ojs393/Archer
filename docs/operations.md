# Archer operations (longevity)

Spare-domain sender meant to run for weeks on one always-on host. Disk and memory stay bounded by recycle rules below. Analytics never invent numbers: when the events ring drops history, APIs expose `coverageFrom` instead of zeros.

## What grows on disk

| Path | What | Recycle |
|---|---|---|
| `data/archer.db` (+ `-wal` / `-shm`) | Primary SQLite store | WAL mode; `PRAGMA wal_checkpoint(TRUNCATE)` after event-ring trim and after daily backup |
| `data/backups/archer-YYYY-MM-DD.db` | Daily `VACUUM INTO` copies | Keep newest **7** (`BACKUPS_KEPT`); older files deleted; skipped when free disk &lt; ~live DB size or **2 GiB** floor |
| `data/logs/app.log` (+ `.1`) | Append-only app log | Rotate at **10 MiB** → rename to `app.log.1` (overwrite previous `.1`) |
| `data/uploads/` | Staged list CSVs | Cleared on every boot; successful imports delete the staged file; daily pass removes files older than **7 days** (including `incoming-*` / `*.partial` orphans) |
| `unsubscribe_tokens` | Opaque unsub ids (1 per send) | Newest **100,000** (`KEEP_UNSUB_TOKENS`); trimmed every **1,000** inserts — older mail links may 404 after prune |

Events table: newest **50,000** rows (`KEEP_EVENTS`). Timeseries / errors carry `coverageFrom` for the oldest kept event so rotated history is not shown as empty zeros. Summary / runs count `sends` rows and stay exact.

MX/DNS domain cache: at most **10,000** entries (LRU). SSE clients that stop reading are dropped once ~8 MiB is buffered for them. List CSV multipart uploads reject above **200 MiB**.

### Daily cap and large lists

- Schedule `dailyCap` max is **300,000** (`MAX_DAILY_CAP`). A 300k list with cap 100k takes ~3 send days (plus weekends/window rules).
- Caps above **5,000** still need an https `publicBaseUrl` (Gmail/Yahoo one-click rule) — see gates.
- Import + enqueue are memory-light (streamed CSV, SQLite). Prefer **≥2 GiB free** before 100k+ imports or rely on `npm run doctor` / `npm run test:stress`.

## Restore from backup

1. Stop Archer (supervisor / process).
2. Copy the newest good `data/backups/archer-YYYY-MM-DD.db` over `data/archer.db` (or delete the live db and let boot restore automatically — corrupt files are detected with `integrity_check` and replaced from the newest backup).
3. Start again. Changes after that backup’s date are gone.

On boot, if the live DB is corrupt and no backup exists, the bad file is moved aside and an empty DB is created.

## Recommended host

- Always-on laptop or mini PC on the operator’s LAN; VPN notes live in the design spec (keep the SMTP path stable).
- Bind stays on `127.0.0.1` for the UI API; optional `ARCHER_PUBLIC_PORT` exposes `/u/:token` and `POST /sns`.
- Free disk for DB + 7 daily backups + one rotated log; aim for **≥2 GiB** free (`npm run doctor` warns below that). Watch the backup log line if `VACUUM INTO` fails (usually disk full).
- Scale probes: `npm run test:stress` (optional `STRESS_SEND=1`, `STRESS_NS=10000,50000,…`).

## Spam / complaint charts

Point SES Bounce and Complaint notifications at an SNS topic, then subscribe that topic to HTTPS `https://<public-host>/sns` (the `ARCHER_PUBLIC_PORT` listener). Archer verifies the SNS signature, auto-confirms the subscription, suppresses permanent bounces and complaints, and shows counts on Dashboard → Feedback. Until the first event arrives, feedback answers `available: false` with setup guidance — never fabricated rates.

## Coming in Task 13

End-to-end Playwright coverage, root README polish, and desktop launcher finish. This file is the ops source of truth until then.
