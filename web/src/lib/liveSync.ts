/**
 * Poll interval while a campaign is actively sending.
 * SSE (`/api/events`) already invalidates queries; this is a safety net so
 * progress bars keep moving even if a status event is coalesced.
 *
 * Trade-off: lower = snappier UI, higher = less load on SQLite/HTTP.
 */
export const LIVE_REFETCH_MS = 2_000;
