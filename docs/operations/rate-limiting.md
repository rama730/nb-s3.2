# Rate Limiting Modes

Rate limiting is implemented in:
- `src/lib/security/rate-limit.ts`

## Modes

## `best-effort` (default)
- Uses Upstash Redis when available.
- Falls back to per-instance in-memory buckets when Redis is unavailable.
- Logs a one-time warning on fallback.
- Suitable for local/dev and low-risk environments.

## `distributed-only`
- Requires Redis availability.
- If Redis is unavailable, requests are denied (`allowed: false`).
- Use for production environments where distributed enforcement is required.

Set mode with:
- `RATE_LIMIT_MODE=best-effort|distributed-only`

## Operational caveat
- In-memory fallback is not shared across instances.
- In multi-instance deployments, use `distributed-only` + Redis for strict guarantees.
