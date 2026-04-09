# Engineering Standards Charter

Last updated: 2026-04-08

This charter is the source of truth for build, change, and optimization standards in `nb-s3`.

It extends the repo's existing contracts without replacing them. Route/page contracts, runtime-boundary rules, API contracts, security gates, and stability-readiness gates remain authoritative. This charter adds the missing cross-cutting standards layer that decides how new work is shaped before it lands.

## Primary Objective

Maintain and optimize the system for maximum long-term stability, performance, and unwavering logical consistency across the entire application stack.

## Non-Negotiable Standards

### 1. Stability Before Throughput Claims

- All architecture decisions must prefer stable, bounded, and observable behavior over optimistic peak-case behavior.
- Graceful degradation is required for hot paths. Public cached routes may serve stale-or-shed; authenticated shells and active surfaces fail closed unless a documented contract says otherwise.
- No feature, refactor, or optimization may be described as "1M ready" without evidence from the release gate, load suite, capacity audit, rollout readiness checks, and final headroom report.

### 2. Single Canonical Logic Flow

- A behavior that appears in more than one surface must be implemented once and reused everywhere.
- Canonical logic must live in a shared helper, view model, contract, or component instead of being recreated inline.
- When a fallback or presentation rule is established, every surface that renders that behavior must follow the same rule set.

First-wave canonical domains:
- identity and avatar fallback behavior
- status and lifecycle labels, tones, and summary lines
- profile normalization and display defaults
- people-card relationship actions
- connection feed contract and invalidation behavior
- import filtering and file-boundary rules

### 3. Runtime Boundaries Stay Explicit

- Request, public-read, realtime, and worker planes must remain intentionally separated.
- Worker-only imports are forbidden in web request paths.
- Durable invalidation and ephemeral collaboration traffic must remain on their assigned channels.
- New background work must declare its route-class impact, invalidation ownership, and degradation behavior.

### 4. Performance Is A Contract

Every meaningful change must evaluate:
- affected runtime plane
- affected route class
- cache or invalidation strategy
- initial payload risk
- concurrency and contention risk
- query fan-out and bounded-read behavior
- impact on background channels
- observability and rollback requirements

The existing page contract is the baseline. The same discipline now applies to server actions, API handlers, realtime entrypoints, and worker ingress.

### 5. Lean Complexity Budget

- No new dependency without a concrete functional or operational reason.
- No unbounded fetches, scans, joins, or pagination paths on hot surfaces.
- No duplicate fetch paths between metadata, shells, loaders, and optimistic reconciliation.
- No hidden background channels, hidden retries, or "temporary" parallel logic that duplicates an existing canonical flow.

### 6. SQL Governance

- Existing queries and schema paths must be optimized before any new SQL asset is considered.
- Structural DB work must happen through the established migration framework and remigration workflow.
- New migration files or new standalone SQL assets are disallowed by default.
- Break-glass SQL exceptions require an explicit manifest entry with owner, reason, and expiry.

The live manifest is [sql-governance.manifest.json](/Users/chrama/Downloads/nb-s3/standards/sql-governance.manifest.json).

### 7. High-Risk Changes Need Machine-Readable Review

High-risk changes must carry a machine-readable impact review that records:
- runtime planes touched
- route classes touched
- data sources changed
- canonical logic domains touched
- concurrency risk
- observability additions
- rollback strategy
- proof commands and reports
- covered paths

Records live in [standards/impact-reviews](/Users/chrama/Downloads/nb-s3/standards/impact-reviews).

## Required Checks For Meaningful Changes

At minimum, every meaningful change must answer:

1. Which runtime plane is affected?
2. Which route class is affected?
3. What is the cache or invalidation owner?
4. Does it add any concurrency, rate-limit, or contention risk?
5. Does it change any DB query path, shape, or remigration requirement?
6. Does it reuse canonical logic or introduce a duplicate behavior?
7. What logs, metrics, or alerts prove the change is healthy?
8. What rollback path exists if the change regresses latency, correctness, or consistency?
9. Which commands or reports prove the change is safe to ship?

## Enforcement Model

The standards program rolls out in three phases:

- Phase 1: visible debt, blocking for new canonical logic and SQL governance, report-only for legacy data-shape and impact-review gaps
- Phase 2: blocking for first-wave canonical domains and strict SQL governance
- Phase 3: blocking for all high-risk impact reviews and remaining canonical-surface migrations

The enforcement matrix lives in [engineering-standards-enforcement-matrix.md](/Users/chrama/Downloads/nb-s3/docs/architecture/engineering-standards-enforcement-matrix.md).

## Exception Policy

Exceptions are narrow and temporary.

Every exception must include:
- the violated standards rule ID
- the reason the exception is necessary now
- the exact affected paths or runtime planes
- the rollback or removal task
- the expiry point

Exceptions never create a second canonical path. They only buy time to migrate toward the canonical path already defined here.
