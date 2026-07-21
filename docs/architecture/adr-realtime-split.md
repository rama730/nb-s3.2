# ADR: Realtime Split

## Decision

Durable invalidation and ephemeral collaboration use separate channel wrappers on the same managed transport:

- Durable invalidation: Supabase-backed subscriptions for user notifications and active resources.
- Ephemeral collaboration: Supabase Realtime presence channels for cursor, typing, and online state.

## Why

- Cursor, typing, and heartbeat traffic are not durable business events.
- Collaboration fanout should not depend on Postgres change streams or a second service deployment.
- Active-only presence is easier to cap, observe, and shed cleanly.

## Consequences

- Cursor and typing hooks use [presence-client.ts](/Users/chrama/Downloads/nb-s3/src/lib/realtime/presence-client.ts).
- Supabase owns channel connection authentication and protocol heartbeats.
- Cursor, typing, and online presence state is never written to Postgres; the profile heartbeat stores only a coarse `lastActiveAt` timestamp.
