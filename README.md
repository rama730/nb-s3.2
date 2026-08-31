# nb-s3

`nb-s3` is a Next.js product shell with explicit scale boundaries for authenticated delivery, public feed delivery, realtime collaboration, and heavy Git/import jobs.

## System Overview

The repo is split into four runtime paths:

- Request path: Next.js app routes, middleware, route contracts, and authenticated shells.
- Public read path: CDN plus Redis backed feeds and public cache envelopes.
- Realtime path: Supabase Realtime channels for durable invalidation, cursor presence, and typing traffic.
- Worker path: Inngest orchestration with worker-only execution for Git sync and project import flows.

The most important architecture docs live here:

- [System map](docs/architecture/system-map.md)
- [Engineering standards charter](docs/architecture/engineering-standards-charter.md)
- [Engineering standards enforcement matrix](docs/architecture/engineering-standards-enforcement-matrix.md)
- [Stability rollout runbook](docs/stability-rollout-runbook.md)
- [Page data contract](docs/performance/page-data-contract.md)
- [Security checklist](docs/security-checklist.md)

## Runtime Boundaries

Request delivery is classified into three route classes:

- `public_cached`: CDN plus Redis first, stale-or-shed under overload.
- `user_shell`: authenticated shell plus minimal bootstrap, one background notification stream max.
- `active_surface`: active conversation/editor/workspace surfaces only, two background channels max.

Those contracts are enforced in:

- [page-contract.ts](src/lib/performance/page-contract.ts)
- [route-class.ts](src/lib/routing/route-class.ts)
- [check-page-performance-contract.ts](scripts/check-page-performance-contract.ts)
- [check-runtime-boundaries.ts](scripts/check-runtime-boundaries.ts)

## Realtime Model

Durable invalidation and ephemeral collaboration use Supabase-backed wrappers:

- [subscriptions.ts](src/lib/realtime/subscriptions.ts)
- [RealtimeProvider.tsx](src/components/providers/RealtimeProvider.tsx)
- Presence client transport: [presence-client.ts](src/lib/realtime/presence-client.ts)

Cursor, typing, and online presence state remains ephemeral and is not written to Postgres.

## Worker Model

The web deployment must not register heavy Git/import workers. Function registration is controlled by:

- [registry.ts](src/inngest/registry.ts)
- [route.ts](src/app/api/v1/inngest/route.ts)

Set `INNGEST_EXECUTION_ROLE=web` for the web app and `INNGEST_EXECUTION_ROLE=worker` for the worker deployment.

## Core Commands

```bash
npm run typecheck
npm run test:unit:coverage
npm run check:db:migration-sources
npm run check:engineering-standards
npm run check:page-contract
npm run check:force-dynamic-allowlist
npm run check:runtime-boundaries
npm run check:stability-release -- --target=staging
```

Dedicated runtime commands:

```bash
npm run dev
npm run dev:collab
npm run run:load-suite -- --base-url=http://127.0.0.1:3000 --auth-cookie="sb-access-token=...; sb-refresh-token=..."
```

`npm run dev` starts only the Next.js app. Use `npm run dev:collab` when actively developing collaborative Docs; it adds the local Yjs server. Typing indicators and cursor presence connect through Supabase Realtime.

## Environment

The minimal local env template is in [.env.local.example](.env.local.example).

Database replay and credentialed E2E runs require disposable targets. Set `DATABASE_URL_FRESH` for migration replay and a distinct `E2E_DATABASE_URL` for E2E fixtures; neither workflow falls back to `DATABASE_URL`.

The new scale-critical settings are:

- `INNGEST_EXECUTION_ROLE`
- `LOAD_SHEDDING_ENABLED`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

## Operational Proof

Repo code is only one part of scale readiness. The final rollout and capacity artifacts live in:

- [ops/stability/README.md](ops/stability/README.md)
- [capacity-audit.example.json](ops/stability/capacity-audit.example.json)
- [production-rollout.example.json](ops/stability/production-rollout.example.json)

Readiness is not claimed until:

- the workspace counter migration is applied
- the capacity audit is approved
- the production rollout plan is approved
- the load suite is green
- [reports/stability/headroom/latest.json](reports/stability/headroom/latest.json) reports `READY`
