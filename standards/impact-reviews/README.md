# Impact Reviews

High-risk changes in `nb-s3` must add a machine-readable JSON record in this directory.

Use this directory for changes that touch one or more of:
- `src/app/api/**`
- `src/app/actions/**`
- `src/lib/realtime/**`
- `src/inngest/**`
- `drizzle/**`
- `src/lib/security/**`
- `src/lib/performance/**`
- `src/lib/routing/**`
- cross-surface canonical logic migrations

Required fields are enforced by `npm run check:impact-review`:
- runtime planes
- route classes
- changed data sources
- canonical logic domains
- concurrency risk
- observability additions
- rollback strategy
- proof commands and reports
- covered paths

Phase policy:
- Phase 1: report-only by default, strict in targeted CI jobs
- Phase 2: strict for production-bound and break-glass changes
- Phase 3: strict for every high-risk change set

The schema is defined in [impact-review.ts](/Users/chrama/Downloads/nb-s3/src/lib/standards/impact-review.ts).
