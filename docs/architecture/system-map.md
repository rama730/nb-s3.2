# System Map

## Request Path

1. Requests enter middleware in [middleware.ts](/Users/chrama/Downloads/nb-s3/src/lib/supabase/middleware.ts).
2. Middleware classifies the route as `public_cached`, `user_shell`, or `active_surface`.
3. Protected shells resolve local JWT-backed auth snapshots instead of remote auth lookups.
4. Page contracts in [page-contract.ts](/Users/chrama/Downloads/nb-s3/src/lib/performance/page-contract.ts) define cache strategy, bootstrap read model, overload mode, and background-channel budget.

## Public Read Path

1. Public feed requests enter [projects route](/Users/chrama/Downloads/nb-s3/src/app/api/v1/projects/route.ts).
2. Cache keys and envelopes are resolved through [public-feed-service.ts](/Users/chrama/Downloads/nb-s3/src/lib/projects/public-feed-service.ts) and [redis.ts](/Users/chrama/Downloads/nb-s3/src/lib/redis.ts).
3. Anonymous warm-cache hits avoid origin DB reads and fall back to stale-or-shed behavior under overload.

## Authenticated Shell Path

1. The shell renders with `AuthSnapshot` and minimal bootstrap only.
2. Workspace bootstrap reads [profile counters](/Users/chrama/Downloads/nb-s3/src/lib/workspace/profile-counters.ts) from `profiles.workspace_*_count`.
3. Durable invalidation uses the shared user notification stream from [subscriptions.ts](/Users/chrama/Downloads/nb-s3/src/lib/realtime/subscriptions.ts).

## Realtime Path

Durable invalidation:

- [RealtimeProvider.tsx](/Users/chrama/Downloads/nb-s3/src/components/providers/RealtimeProvider.tsx)
- [subscriptions.ts](/Users/chrama/Downloads/nb-s3/src/lib/realtime/subscriptions.ts)

Ephemeral collaboration:

- Token issuance: [presence-token route](/Users/chrama/Downloads/nb-s3/src/app/api/realtime/presence-token/route.ts)
- Browser transport: [presence-client.ts](/Users/chrama/Downloads/nb-s3/src/lib/realtime/presence-client.ts)
- Dedicated WebSocket service: [services/presence/src/server.ts](/Users/chrama/Downloads/nb-s3/services/presence/src/server.ts)

The boundary is intentional: cursor, typing, and heartbeats never persist into Postgres.

## Worker Path

1. App code enqueues events through Inngest.
2. Function registration is resolved by [registry.ts](/Users/chrama/Downloads/nb-s3/src/inngest/registry.ts).
3. `INNGEST_EXECUTION_ROLE=web` registers no worker functions.
4. `INNGEST_EXECUTION_ROLE=worker` registers Git/import and maintenance workers only on the worker deployment.

## Rollout Path

1. Environment validation: [check-stability-env.ts](/Users/chrama/Downloads/nb-s3/scripts/check-stability-env.ts)
2. Release gate: [run-stability-release-gate.ts](/Users/chrama/Downloads/nb-s3/scripts/run-stability-release-gate.ts)
3. Load suite: [run-load-suite.ts](/Users/chrama/Downloads/nb-s3/scripts/run-load-suite.ts)
4. Capacity audit: [check-capacity-audit.ts](/Users/chrama/Downloads/nb-s3/scripts/check-capacity-audit.ts)
5. Rollout readiness: [check-production-rollout-readiness.ts](/Users/chrama/Downloads/nb-s3/scripts/check-production-rollout-readiness.ts)
6. Final readiness gate: [check-1m-readiness.ts](/Users/chrama/Downloads/nb-s3/scripts/check-1m-readiness.ts)
