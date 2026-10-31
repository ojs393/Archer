# Security posture (local Archer)

Archer is a single-tenant loopback app. This is the baseline; re-check after new routes.

## Controls in place

- **Host guard** — rejects non-loopback `Host` (DNS rebinding)
- **Origin + `X-Archer: 1`** — mutating requests must be same-origin (or configured `ARCHER_DEV_ORIGIN`) with the custom header
- **Session cookie** — `archer_session` required for `/api/*` after bootstrap. The cookie signing secret is generated at process start (reboot rotates it); it is not stored in `.env`
- **Public listener** — unsubscribe + SNS only; no session cookie on that port
- **Unsub tokens** — HMAC with `UNSUB_SECRET` (from `.env`, gitignored)
- **Security headers** — `X-Frame-Options`, `CSP frame-ancestors`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, API `Cache-Control: no-store`
- **Secrets** — SMTP password write-only; log redaction via `registerSecret`
- **Setup gate** — `POST /api/campaigns/:id/start`, resume, chain auto-start, and template test-send require `setupCompletedAt` (`409 setup_incomplete`)
- **Launch gates** — campaign start and chain auto-start share `evaluateGates` (`409 gates_failed`)

## Operator habits

- Keep Archer on loopback; do not expose the app port to the internet
- Rotate `UNSUB_SECRET` (and re-save SMTP credentials) if the machine is shared; session secret rotates on every restart
- Prefer the Desktop launcher over pasting tokens into scripts
