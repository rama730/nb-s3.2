# Page Data Contract (Stability + Scale)

This contract applies to all current and future route pages.

## Fetch Rules

1. Server-first orchestration for initial page shell.
2. Parallelize independent reads (`Promise.all`) and dedupe repeated reads.
3. Avoid duplicate fetches between metadata generation and page body.
4. All list endpoints require bounded `limit` + stable cursor (sort key + id).
5. Prefer idempotent reads and monotonic updates (ignore stale responses).

## Database Rules

1. One primary query path per page shell.
2. No unbounded scans/joins for route-critical queries.
3. Read-modify-write flows use transaction boundaries.
4. Existing SQL edits/remigrations first; add new SQL only for proven blockers.

## Cache Rules

1. `public_cached`: SWR TTL allowed.
2. `user_scoped`: request/session-scoped cache only.
3. `realtime`: event-driven refresh, avoid long-lived cache.

