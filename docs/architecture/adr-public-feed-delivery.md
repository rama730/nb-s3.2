# ADR: Public Feed Delivery

## Decision

The public projects feed is delivered through a cache-first Redis path with keyset pagination and stale-cache fallback.

## Why

- Anonymous hot traffic should not drive synchronous origin DB reads on cache hits.
- Offset pagination becomes unstable and expensive under large fanout.
- Public feed caching must stay isolated from personalized recommendation paths.

## Consequences

- Warm-cache public feed hits serve from Redis/CDN first.
- Pagination uses cursor state based on existing sorted columns.
- Sensitive or personalized read paths stay on bounded authenticated APIs.
