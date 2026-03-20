# ADR: Route Classes

## Decision

Every page route is classified as one of:

- `public_cached`
- `user_shell`
- `active_surface`

Those classes are declared in [page-contract.ts](/Users/chrama/Downloads/nb-s3/src/lib/performance/page-contract.ts) and enforced in CI.

## Why

- Route performance rules must be explicit, not inferred from ad hoc page code.
- Overload handling and background-channel budgets differ by route type.
- The route class is the unit that ties cache policy, bootstrap read model, and load shedding together.

## Consequences

- Public routes default to stale-or-shed behavior.
- User shells are limited to one background notification stream.
- Active surfaces are limited to two background channels and no request caching.
