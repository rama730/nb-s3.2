# Stability Rollout Runbook

This runbook turns the remaining 7 operational hardening items into an executable flow.

## 1. Apply and verify the workspace counter migration

Check only:

```bash
npm run db:check:workspace-counters
```

Apply and verify:

```bash
npm run db:apply:workspace-counters
```

Artifact:
- `reports/stability/db/workspace-counters.json`

Exit criteria:
- all four `profiles.workspace_*_count` columns exist
- supporting indexes exist
- the report says `"ok": true`

## 2. Validate runtime configuration

Staging:

```bash
npm run check:stability-env -- --target=staging --strict
```

Production:

```bash
npm run check:stability-env -- --target=production --strict
```

Artifact:
- `reports/stability/env/<target>.json`

This validates:
- Supabase and app URLs
- Redis config
- Turnstile config
- OTLP exporter config
- presence token secret and WebSocket URL
- Inngest execution role
- distributed rate limiting mode
- load-shedding budgets
- Git/import worker budgets

## 3. Run the release gate in a prod-like environment

Staging release gate:

```bash
npm run check:stability-release -- --target=staging --include-e2e
```

Production release gate:

```bash
npm run check:stability-release -- --target=production --include-e2e
```

Artifact:
- `reports/stability/release/latest.json`

## 4. Execute the hardened load suite

```bash
npm run run:load-suite -- --base-url=https://staging.example.com --auth-cookie="sb-access-token=...; sb-refresh-token=..."
```

Artifact:
- `reports/stability/load/latest.json`

Supported suites:
- `public-projects-feed`
- `auth-entry-pages`
- `authenticated-shells`
- `workspace-bootstrap`
- `messages-reconnect-storm`
- `presence-room-fanout`
- `worker-isolation`

If you only want a subset:

```bash
npm run run:load-suite -- --base-url=https://staging.example.com --auth-cookie="..." --suites=public-projects-feed,workspace-bootstrap
```

## 5. Validate external capacity and vendor ceilings

Start from:
- `ops/stability/capacity-audit.example.json`

Create:
- `ops/stability/capacity-audit.json`

Then validate it:

```bash
npm run check:capacity-audit -- --strict
```

Artifact:
- `reports/stability/capacity-audit/latest.json`

Required services in the audit:
- Supabase Auth
- Supabase Postgres
- Supabase Realtime
- Redis
- Object storage
- CDN
- Hosting
- Presence service
- Worker plane

## 6. Check production rollout readiness

Start from:
- `ops/stability/production-rollout.example.json`

Create:
- `ops/stability/production-rollout.json`

Then validate readiness:

```bash
npm run check:production-rollout -- --strict
npm run check:hardening-rollout
```

Artifact:
- `reports/stability/rollout/latest.json`

This step expects:
- a valid production rollout plan
- a passing release report
- a passing load report
- a passing capacity audit report
- a recent `.e2e-last-run-id`
- rollout promotion env vars when `check:hardening-rollout` is used

## 7. Produce the final 1M-readiness decision

Report only:

```bash
npm run check:1m-readiness
```

Gate the rollout:

```bash
npm run check:1m-readiness -- --strict
```

Artifact:
- `reports/stability/headroom/latest.json`

Statuses:
- `READY`: all required evidence is present and healthy
- `CONDITIONAL`: the system has no hard blockers, but proof is incomplete
- `BLOCKED`: at least one required proof step failed or is missing

## Recommended order

```bash
npm run db:apply:workspace-counters
npm run check:stability-env -- --target=staging --strict
npm run check:stability-release -- --target=staging --include-e2e
npm run run:load-suite -- --base-url=https://staging.example.com --auth-cookie="..."
npm run check:capacity-audit -- --strict
npm run check:production-rollout -- --strict
npm run check:hardening-rollout
npm run check:1m-readiness -- --strict
```
