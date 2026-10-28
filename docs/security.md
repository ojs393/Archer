# Security posture (local Archer)

Archer is a single-tenant loopback app. This is the baseline; re-check after new routes.

## Controls in place

- **Host guard** — rejects non-loopback `Host` (DNS rebinding)
- **Origin + `X-Archer: 1`** — mutating requests must be same-origin (or configured `ARCHER_DEV_ORIGIN`) with the custom header
- **Session cookie** — `archer_session` required for `/api/*` after bootstrap
- **Public listener** — unsubscribe + SNS only; no session cookie on that port
- **Unsub tokens** — HMAC with `UNSUB_SECRET`
- **Security headers** — `X-Frame-Options`, `CSP frame-ancestors`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, API `Cache-Control: no-store`
- **Secrets** — SMTP password write-only; log redaction via `registerSecret`

## Operator habits

- Keep Archer on loopback; do not expose the app port to the internet
- Rotate `SESSION` / `UNSUB` secrets if the machine is shared
- Prefer the Desktop launcher over pasting tokens into scripts
