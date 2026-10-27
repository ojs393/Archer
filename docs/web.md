# Archer web app

React 18 + TypeScript (strict) + Tailwind 3 + Radix/shadcn primitives, built by Vite into `dist/web`, which the backend serves at `/`. Sources live in `web/` (`index.html`, `src/`, `public/`); `vite.config.ts` and `tailwind.config.ts` sit at the repo root.

## Scripts
| Command | What it does |
|---|---|
| `npm start` | `doctor --quick` rebuilds `dist/web` when it is missing or older than any file under `web/`, `vite.config.ts`, `tailwind.config.ts` or `package-lock.json` (line `web app`: PASS / FIXED / FAIL; a failed build is reported but does not stop the server, which then serves the last good build or a placeholder page). |
| `npm run build:web` | Production build to `dist/web` (no source maps; panels are separate chunks). |
| `npm run dev:web` | Vite dev server on `http://localhost:5173` with hot reload. |
| `npm run build:icons` | Re-renders every icon from `web/public/brand/mark.svg` (outputs are committed). |
| `npm run typecheck` | Server and web (`web/tsconfig.json`) type checks. |
| `npm test` | Node tests and the jsdom web tests (`web/src/**/*.test.{ts,tsx}`). |

## Developing the UI
1. Start the backend with the Vite origin allowed: `ARCHER_DEV_ORIGIN=http://localhost:5173 npm run dev`.
2. In another terminal: `npm run dev:web`, then open `http://localhost:5173`.

The dev server proxies `/api` and `/u/` to the backend port read from `data/server.json` (or `$ARCHER_DATA_DIR/server.json`), falling back to 5199; restart `dev:web` if the backend comes up on a different port. The proxy rewrites `Host` (`changeOrigin`), so the backend's Host check passes; `ARCHER_DEV_ORIGIN` lets mutating requests from the Vite origin through the Origin check.

## Structure
- `src/lib/api.ts`: `api.get/post/put/del/upload`. Same-origin, sends `X-Archer: 1` on non-GET, throws `ApiError { status, code, message, details }` from the server error envelope (status 0 / `network_error` when the server cannot be reached). A 401 re-opens the session (`GET /api/session`) once, shared between concurrent requests, and retries. Server types come from `server/http/contract.ts` through `src/lib/types.ts`, type-only.
- `src/lib/eventStream.ts` + `useEventStream.ts`: one ref-counted `EventSource` on `/api/events` for the whole app (closed 1 s after the last consumer unmounts), reconnecting with 1 s to 30 s exponential backoff and jitter, re-opening the session before each reconnect. `status` and `health` events are written straight into the React Query cache. `worker` events invalidate `status` and `campaigns`; `status` events invalidate `campaigns` and `analytics`; finished `import` events invalidate `lists`. Each key is coalesced (one invalidation per 750 ms) and `analytics` refetches at most once every 5 s; a reconnect invalidates all of them, since events may have been missed. The shell holds the connection (`useEventStream({ enabled })`, once the session is open); display-only components read `useEventStreamState()`. `useStreamEvent(name, handler)` subscribes to raw events.
- React Query defaults: `staleTime` 10 s, one retry for queries (none for 4xx), no mutation retries, refetch on window focus. Health is also polled every 60 s.
- `src/shell/`: header (brand, five top tabs, run status pill, health dots), reconnect banner (after 3 s down), panel error boundary. The active tab lives in `location.hash` (`#/dashboard` default, `#/runs`, `#/audience`, `#/templates`, `#/settings`); back/forward work.
- `src/panels/`: one lazily loaded chunk per tab. If a chunk is missing because the app was rebuilt while the page was open, the page reloads once; if it is still missing the panel shows a Retry state. The server answers missing files (anything under `/assets/` or with an extension) with 404, never with `index.html`.

## Design rules
- White surfaces on a `#fafafa` canvas, zinc text and borders, blue (`#2563eb` family) only for interactive elements and focus (solid 2 px blue-600 ring with 2 px white offset). Status colours (green/amber/red/blue/zinc) only on small dots and badges; red buttons only for destructive confirms in alert dialogs.
- Labels are short nouns; longer explanations sit behind `InfoHint` (click to reveal). No emoji. Icons come from `lucide-react` (plus `BrandMark`).
- Icon-only actions use `IconButton` (borderless 32 x 32, `aria-label` and tooltip from one `label` prop; `destructive` turns the hover red).
- Tokens are CSS variables in `src/index.css`, mapped to Tailwind colours in `tailwind.config.ts`.

## Icons
`web/public/brand/mark.svg` is the source of truth (the inline `BrandMark` component uses the same paths; a test keeps them in sync). `scripts/build-icons.mjs` (resvg-wasm, pure-JS ICO/ICNS writers) writes `web/public/brand/app-icon.svg` (white rounded square + hairline), `favicon.svg`, PNG favicons, apple-touch and PWA icons, `favicon.ico`, `site.webmanifest`, and `assets/icons/archer.{ico,icns}` + 512/1024 PNGs for the desktop launcher. Rounded icons (app icon, favicons, ICO, ICNS, launcher PNGs) have transparent corners; only the full-bleed maskable and apple-touch icons are opaque white. Sizes up to 48 px use a simplified mark (chosen by geometry: no highlight or band, every other feather, kept feathers thickened 1.08x from the wing base) scaled up 1.15x so the wings stay distinct from the dome.
