# Connections QA Matrix (2026-02-11)

## Scope
- `/people?tab=discover`
- `/people?tab=network`
- `/people?tab=requests`
- Profile header connection actions (`/profile`, `/u/[username]`)

## Matrix
- Discover: search debounce, infinite load, connect action optimistic state, dedupe after refetch.
- Discover: per-user dismiss action removes suggestion and persists exclusion across refresh.
- Network: initial load, search, infinite pagination, disconnect action optimistic removal.
- Requests incoming: accept, reject, reject undo (15s), list consistency after realtime event.
- Requests incoming: bulk `Accept all` and `Reject all` with explicit confirmation.
- Requests sent: cancel request, list consistency, badge count consistency.
- Realtime: two-browser session where requester/addressee actions invalidate both clients.
- Data fencing: unauthenticated access to `/people?tab=network` and `/people?tab=requests` should not leak data.
- Error handling: rate-limit paths should return user-visible failure without stale UI state.
- Cooldown: after reject, same requester cannot re-send for 2 days.
- Cross-surface consistency: actions from profile should update `/people` tabs after invalidation.

## Critical Findings Fixed
- Duplicate data sources for connection lists were causing stale tab states.
- Reject action hard-deleted rows; now it is soft reject with undo window.
- Mutation paths lacked consistent rate limiting.
- Discover/requests/network were not on a single feed contract.
- People landing load was pulling request payload eagerly; now request-heavy prefetch runs only when `tab=requests`.
- Realtime invalidation now batches high-frequency events to avoid render/query thrash.
- Legacy duplicate connection/request rows are deduped at feed level for stable UI.

## Automation Coverage
- Added `tests/e2e/connections-smoke.spec.ts` for tab navigation + core action surface checks.
