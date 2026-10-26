# MamaDirect

Local-first spare-domain email sender (Node 22+, SQLite, Fastify, React).

## Quick start

```bash
npm run setup
npm start
```

Opens `http://127.0.0.1:5199`. See `docs/operations.md` for disk growth, backups, log rotation, and restore.

## Docs

- `docs/api.md` — HTTP API contract
- `docs/web.md` — web UI notes
- `docs/operations.md` — longevity / disk recycle / restore

## Task 13 (next)

E2E Playwright suite, fuller README (setup / doctor / desktop launcher), and branch polish before merge. Hardening (log rotate, event ring, upload recycle, MX cache caps) ships ahead of that.
