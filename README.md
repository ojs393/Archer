<p align="center">
  <img src=".github/assets/logo.png" width="112" alt="Archer logo">
</p>

<h1 align="center">Archer</h1>

<p align="center">
  <strong>Bulk email that never leaves your machine.</strong><br>
  Import audiences, personalize HTML, warm up a domain, and send one message at a time through
  Amazon SES or any SMTP provider — with unsubscribe, suppression, and hard safety stops built in.
</p>

<p align="center">
  <a href="#why-archer">Why</a> ·
  <a href="#how-it-works">How</a> ·
  <a href="#security">Security</a> ·
  <a href="#install">Install</a> ·
  <a href="#first-send">First send</a> ·
  <a href="#screenshots">Screenshots</a>
</p>

---

## Why Archer

Most ESPs want your list, your copy, and a monthly tax for the privilege. Archer is the opposite:

| Instead of… | You get… |
|---|---|
| Hosted SaaS that stores your audience | A **local Node app** — SQLite under `data/` on *your* disk |
| “Trust us with the API keys” | SMTP credentials that are **write-only** after save |
| Opaque senders and surprise pauses | Explicit **launch gates**, warm-up, daily caps, bounce tripwires |
| Designing for a marketing team of twelve | A spare domain, a CSV, and a weekend |

**Use it when** you own a domain, have SES (or SMTP), and want honest control over consent, rate, and who actually gets the message — without shipping PII to another company’s cloud.

**Skip it when** you need multi-user orgs, a template marketplace, or guaranteed inbox placement. Archer is honest about that.

## How it works

1. **Setup** — operator → SES/SMTP → DNS (SPF/DKIM/DMARC) → from/unsub/postal → test inboxes.
2. **Audience** — guided CSV/TSV import (comma, semicolon, tab; headers or headerless). Email column auto-detected; other columns become merge fields.
3. **Templates** — HTML + `{{first_name}}`, `{{unsubscribe_url}}`, `{{postal_address}}`, … Live preview fills samples; View uses a server-side render with your sender config.
4. **Runs** — pick list + template + schedule. Gates must pass (SMTP, DNS, compliance tags, test send). Worker sends one personalized message at a time.
5. **Dashboard** — live progress, dense metrics, charts that never invent zeros for rotated history.

Under the hood: Fastify API + React UI, session cookie + CSRF, a self-healing send loop, suppression list, role-address filters, and a desktop launcher (`Archer.app` / `.cmd` / `.desktop`).

## Security

Local-first is the product, not a slogan.

- **Bind** — listens on `127.0.0.1` only. Not a public ESP.
- **Session** — cookie auth; mutating routes require `X-Archer` CSRF.
- **Secrets** — SMTP password write-only; redacted from logs; `UNSUB_SECRET` in local `.env` (gitignored).
- **Data** — audiences, templates, and runs live in gitignored `data/`. Uploads cleared on boot.
- **Compliance** — postal address + unsubscribe mailbox required; List-Unsubscribe headers; one-click when you set an https public base URL.
- **Stops** — bounce-rate tripwire, daily caps, send windows, launch gates before a run can start.

Do **not** expose the port to the internet without a reverse proxy and auth you trust.

## Install

**Needs:** Node.js ≥ 22.13, outbound SMTP (VPN is fine).

```bash
git clone https://github.com/ojs393/Archer.git Archer
cd Archer
npm run setup
```

`setup` installs deps (`npm ci` when a lockfile exists), creates `data/` + local `.env` (with `UNSUB_SECRET`), and runs a quick self-check.

## Start

```bash
npm start
```

Opens `http://127.0.0.1:5199`. First launch walks the setup wizard; you can finish later from **Settings**.

| Command | What it does |
|---|---|
| `npm run setup` | First-time install + dirs + secrets |
| `npm start` | Quick doctor + start (opens the UI) |
| `npm run seed:local` | Demo lists/runs into local `data/` (gitignored) |
| `npm run doctor` | Full health check / repair + self-test |
| `npm run selftest` | Fake SMTP end-to-end send smoke test |
| `npm test` | Unit + integration + web tests |
| `npm run build:web` | Production UI → `dist/web` |
| `npm run typecheck` | `tsc` for server and web |

## First send

1. Finish setup (SMTP test green; DNS may still be propagating).
2. **Audience** → Import — walk the format guide, drop CSV/TSV, map email, attest consent.
3. **Templates** → subject + HTML with compliance merge tags.
4. **Runs** → New run → list, template, schedule → pass gates → Start.
5. Watch **Dashboard** / the run’s metric strip for live progress.

Postal address and unsubscribe mailbox are required (CAN-SPAM). For >5k/day to Gmail/Yahoo, set an https public base URL (tunnel) for one-click unsubscribe.

Before a real list: [`docs/PRELAUNCH.md`](docs/PRELAUNCH.md).

## Screenshots

Captured from a local demo instance (sample list + template; no live mail sent).

| Setup | Dashboard |
|---|---|
| ![Setup wizard](docs/screenshots/01-setup.png) | ![Dashboard](docs/screenshots/02-dashboard.png) |

| Audience | Templates |
|---|---|
| ![Audience](docs/screenshots/03-audience.png) | ![Templates](docs/screenshots/04-templates.png) |

| Runs | Settings |
|---|---|
| ![Runs](docs/screenshots/05-runs.png) | ![Settings](docs/screenshots/06-settings.png) |

<p align="center">
  <img src="docs/screenshots/07-new-run.png" alt="New run wizard" width="900">
</p>

## Layout

| Path | Role |
|---|---|
| `config/` | Vite, Vitest, Tailwind, TypeScript |
| `server/` | HTTP API, send worker, SQLite |
| `web/` | React UI |
| `scripts/` | setup, doctor, icons |
| `tests/` | unit + integration |
| `docs/` | API, ops, screenshots |
| `data/` | Local runtime only (gitignored) |

## Desktop launcher

From setup (**Add to Desktop**) or **Settings → App**:

| OS | What you get |
|---|---|
| macOS | `Archer.app` with embedded `.icns` |
| Windows | `Archer.cmd` (+ `.lnk` with `.ico` when possible) |
| Linux | `Archer.desktop` |

## Ops

Disk under `data/`: SQLite (+ WAL), uploads, logs, backups. Event ring capped; analytics never invents zeros for rotated history. Details: [`docs/operations.md`](docs/operations.md).

## Docs

- [`docs/api.md`](docs/api.md) — HTTP API  
- [`docs/web.md`](docs/web.md) — UI conventions  
- [`docs/operations.md`](docs/operations.md) — disk, backups, recycle  
- [`docs/PRELAUNCH.md`](docs/PRELAUNCH.md) — manual checks before a real list  

## License

Private repository. All rights reserved unless otherwise noted.
