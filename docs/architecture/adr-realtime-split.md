# ADR: Realtime Split

## Decision

Durable invalidation and ephemeral collaboration use different transports:

- Durable invalidation: Supabase-backed subscriptions for user notifications and active resources.
- Ephemeral collaboration: dedicated WebSocket presence service backed by Upstash Redis TTL state and pub/sub.

## Why

- Cursor, typing, and heartbeat traffic are not durable business events.
- Collaboration fanout should not depend on Postgres change streams.
- Active-only presence is easier to cap, observe, and shed cleanly.

## Consequences

- Cursor and typing hooks use [presence-client.ts](/Users/chrama/Downloads/nb-s3/src/lib/realtime/presence-client.ts).
- Presence room access is mediated by short-lived room tokens.
- Presence traffic is never written to Postgres.
