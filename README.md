# nb-s3

`nb-s3` is a Next.js product shell with explicit scale boundaries for authenticated delivery, public feed delivery, realtime collaboration, and heavy Git/import jobs.

## System Overview

The repo is split into four runtime paths:

- Request path: Next.js app routes, middleware, route contracts, and authenticated shells.
- Public read path: CDN plus Redis backed feeds and public cache envelopes.
- Realtime path: Supabase-backed durable invalidation plus a separate WebSocket presence plane for cursor and typing traffic.
- Worker path: Inngest orchestration with worker-only execution for Git sync and project import flows.

The most important architecture docs live here:

- [System map](/Users/chrama/Downloads/nb-s3/docs/architecture/system-map.md)
- [Stability rollout runbook](/Users/chrama/Downloads/nb-s3/docs/stability-rollout-runbook.md)
- [Page data contract](/Users/chrama/Downloads/nb-s3/docs/performance/page-data-contract.md)
- [Security checklist](/Users/chrama/Downloads/nb-s3/docs/security-checklist.md)

## Runtime Boundaries

Request delivery is classified into three route classes:

- `public_cached`: CDN plus Redis first, stale-or-shed under overload.
- `user_shell`: authenticated shell plus minimal bootstrap, one background notification stream max.
- `active_surface`: active conversation/editor/workspace surfaces only, two background channels max.

Those contracts are enforced in:

- [page-contract.ts](/Users/chrama/Downloads/nb-s3/src/lib/performance/page-contract.ts)
- [route-class.ts](/Users/chrama/Downloads/nb-s3/src/lib/routing/route-class.ts)
- [check-page-performance-contract.ts](/Users/chrama/Downloads/nb-s3/scripts/check-page-performance-contract.ts)
- [check-runtime-boundaries.ts](/Users/chrama/Downloads/nb-s3/scripts/check-runtime-boundaries.ts)

## Realtime Model

Durable invalidation stays on Supabase-backed wrappers:

- [subscriptions.ts](/Users/chrama/Downloads/nb-s3/src/lib/realtime/subscriptions.ts)
- [RealtimeProvider.tsx](/Users/chrama/Downloads/nb-s3/src/components/providers/RealtimeProvider.tsx)

Ephemeral collaboration traffic is isolated:

- Presence token API: [route.ts](/Users/chrama/Downloads/nb-s3/src/app/api/realtime/presence-token/route.ts)
- Presence client transport: [presence-client.ts](/Users/chrama/Downloads/nb-s3/src/lib/realtime/presence-client.ts)
- Presence service: [server.ts](/Users/chrama/Downloads/nb-s3/services/presence/src/server.ts)

## Worker Model

The web deployment must not register heavy Git/import workers. Function registration is controlled by:

- [registry.ts](/Users/chrama/Downloads/nb-s3/src/inngest/registry.ts)
- [route.ts](/Users/chrama/Downloads/nb-s3/src/app/api/v1/inngest/route.ts)

Set `INNGEST_EXECUTION_ROLE=web` for the web app and `INNGEST_EXECUTION_ROLE=worker` for the worker deployment.

## Core Commands

```bash
npm run typecheck
npm run test:unit
npm run check:page-contract
npm run check:force-dynamic-allowlist
npm run check:runtime-boundaries
npm run check:stability-release -- --target=staging
```

Dedicated runtime commands:

```bash
npm run dev
```

`npm run dev` now starts both the Next.js app and the dedicated local presence service so typing indicators and cursor presence work in local development.

Dedicated runtime commands:

```bash
npm run presence:dev
npm run run:load-suite -- --base-url=http://127.0.0.1:3000 --auth-cookie="sb-access-token=...; sb-refresh-token=..."
```

## Environment

The minimal local env template is in [.env.local.example](/Users/chrama/Downloads/nb-s3/.env.local.example).

The new scale-critical settings are:

- `PRESENCE_TOKEN_SECRET`
- `NEXT_PUBLIC_PRESENCE_WS_URL`
- `INNGEST_EXECUTION_ROLE`
- `LOAD_SHEDDING_ENABLED`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

## Operational Proof

Repo code is only one part of scale readiness. The final rollout and capacity artifacts live in:

- [ops/stability/README.md](/Users/chrama/Downloads/nb-s3/ops/stability/README.md)
- [capacity-audit.example.json](/Users/chrama/Downloads/nb-s3/ops/stability/capacity-audit.example.json)
- [production-rollout.example.json](/Users/chrama/Downloads/nb-s3/ops/stability/production-rollout.example.json)

Readiness is not claimed until:

- the workspace counter migration is applied
- the capacity audit is approved
- the production rollout plan is approved
- the load suite is green
- [reports/stability/headroom/latest.json](/Users/chrama/Downloads/nb-s3/reports/stability/headroom/latest.json) reports `READY`
