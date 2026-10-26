<p align="center">
  <img src=".github/assets/logo.png" width="112" alt="MamaDirect logo">
</p>

<h1 align="center">MamaDirect</h1>

<p align="center">
  <strong>Local-first bulk email for a spare domain.</strong><br>
  Runs on your computer. Sends one personalized message at a time through Amazon SES SMTP
  or any SMTP provider. Built-in unsubscribe, suppression, warm-up, and a self-healing send loop.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#start">Start</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#first-send">First send</a> ·
  <a href="#desktop-launcher">Desktop</a> ·
  <a href="#security">Security</a>
</p>

---

## What it is

MamaDirect is a **local Node app**, not a hosted ESP. You clone it, run it on macOS, Linux, or Windows, and open a dashboard on `127.0.0.1`. Data stays in a SQLite database under `data/` on your machine.

| You get | You do not get |
|---|---|
| Setup wizard, CSV audiences, HTML templates, scheduled runs | Cloud hosting or multi-user accounts |
| CAN-SPAM footer + unsubscribe headers/links | Guaranteed inbox placement |
| Warm-up, daily caps, send windows, safety stops | Built-in design templates marketplace |
| Desktop launcher (Mac / Windows / Linux) | A replacement for Mailchimp/Customer.io ops teams |

Honest limits: delivery/bounce charts stay empty until your provider feedback is wired; the dashboard never invents numbers for rotated event history.

## Install

**Needs:** Node.js ≥ 22.13, outbound SMTP (VPN is fine).

```bash
git clone https://github.com/ojs393/Hermes.git MamaDirect
cd MamaDirect
npm run setup
```

`setup` installs dependencies (`npm ci` when a lockfile is present), creates `data/` and a local `.env` (with `UNSUB_SECRET`), and runs a quick self-check.

## Start

```bash
npm start
```

Doctor runs a quick repair (deps, data dirs, DB integrity, stale web build), then the app opens:

`http://127.0.0.1:5199`

First launch shows the setup wizard (operator → provider → domain DNS → addresses → test inboxes). You can skip and finish later from **Settings**.

### Commands

| Command | What it does |
|---|---|
| `npm run setup` | First-time install + dirs + secrets |
| `npm start` | Quick doctor + start (opens the UI) |
| `npm run doctor` | Full health check / repair + self-test |
| `npm run selftest` | Fake SMTP end-to-end send smoke test |
| `npm test` | Unit + integration + web tests |
| `npm run build:web` | Production UI bundle → `dist/web` |
| `npm run build:icons` | Regenerate favicons + desktop icons (committed) |
| `npm run typecheck` | `tsc` for server and web |

## Screenshots

Captured from a local demo instance (sample list + template; no live mail sent). Dashboard metrics stay at zero until you send for real.

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

## First send

1. Complete setup (SMTP test green; DNS may still be propagating).
2. **Audience** → import a CSV (email column auto-detected).
3. **Templates** → subject + HTML with `{{first_name}}`, `{{unsubscribe_url}}`, `{{postal_address}}`.
4. **Runs** → New run → pick list, template, schedule → pass launch gates → Start.
5. Watch **Dashboard** for live progress.

Postal address and unsubscribe mailbox are required (CAN-SPAM). For >5k/day to Gmail/Yahoo, set an https public base URL (tunnel) for one-click unsubscribe.

Before a real list, walk through [`docs/PRELAUNCH.md`](docs/PRELAUNCH.md).

## Desktop launcher

From setup (**Add to Desktop**) or Settings:

| OS | What you get |
|---|---|
| macOS | `MamaDirect.command` + app icon (`.icns`) |
| Windows | `MamaDirect.cmd` (+ `.lnk` with `.ico` when possible) |
| Linux | `MamaDirect.desktop` |

Icons live in `assets/icons/` and `web/public/`. Regenerate with `npm run build:icons`.

## Ops & longevity

Disk under `data/`: SQLite (+ WAL), uploads, logs, backups.

- Event ring capped (~50k); analytics never invents zeros for rotated history.
- Logs rotate at 10 MiB (`app.log` → `app.log.1`).
- Daily DB backups, keep 7; boot restores from backup if corrupt.
- Uploads cleared on boot; aged temp files recycled.
- Details: [`docs/operations.md`](docs/operations.md).

## Docs

- [`docs/api.md`](docs/api.md) — HTTP API
- [`docs/web.md`](docs/web.md) — UI conventions
- [`docs/operations.md`](docs/operations.md) — disk, backups, recycle
- [`docs/PRELAUNCH.md`](docs/PRELAUNCH.md) — manual checks before a real list

## Security

- Binds to `127.0.0.1` only.
- Session cookie + CSRF (`X-MamaDirect`) on mutating routes.
- SMTP password write-only; secrets redacted from logs.
- Do not expose the port to the public internet without a reverse proxy and auth you trust.

## License

Private repository. All rights reserved unless otherwise noted.
