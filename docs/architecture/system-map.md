# System Map

Subsystem maps: [Messaging system](./messaging-system.md), [market skill catalog](./adr-market-skill-catalog.md), [extension crash recovery](./extension-crash-recovery.md), and [project file leases](./project-file-leases.md).

## Request Path

1. Requests enter the repository root [middleware.ts](/Users/chrama/Downloads/nb-s3/middleware.ts), which owns CSP and delegates auth/session work to [Supabase middleware](/Users/chrama/Downloads/nb-s3/src/lib/supabase/middleware.ts).
2. Middleware classifies the route as `public_cached`, `user_shell`, or `active_surface`; CSP has a single owner and is not duplicated in `next.config.ts`.
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

- Supabase presence transport: [presence-client.ts](/Users/chrama/Downloads/nb-s3/src/lib/realtime/presence-client.ts)
- Typing adapter: [usePresenceTyping.ts](/Users/chrama/Downloads/nb-s3/src/hooks/usePresenceTyping.ts)

The boundary is intentional: cursor and typing state never persist into Postgres. The authenticated heartbeat route updates only the profile's coarse `lastActiveAt` timestamp.

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

All three readiness checks run in strict mode. Missing load, capacity, or rollout evidence is a blocking result rather than an implicit approval.

## Database Change Path

1. Add an append-only numbered SQL file under `drizzle/` and register it in both the Drizzle journal and SQL governance manifest.
2. Run `npm run check:db:migration-sources` for checksum, tag, ordering, and transactional-boundary validation without touching a database.
3. Replay twice against an explicit disposable `DATABASE_URL_FRESH`; the replay tooling never provisions or falls back to the primary database.
4. Run `npm run check:db:live-lineage` read-only against the target environment before rollout.

Applied migration checksums are immutable. A changed checksum or a partially applied migration is a hard failure.
Legacy journal inference and out-of-band schema repairs are disabled by default and require explicit one-time adoption flags.

Schema tables are exported from `src/lib/db/schema/index.ts`. New modules should import directly from the root schema export so table ownership remains visible in review and static checks.
