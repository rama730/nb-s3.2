# New Page Fast-by-Default Checklist

Use this checklist before merging any new `src/app/**/page.tsx`.

## Required

- [ ] Add a route entry in `src/lib/performance/page-contract.ts`.
- [ ] Set an explicit rendering mode (`static` / `revalidate` / `dynamic`) with justification.
- [ ] Define data class (`public_cached` / `user_scoped` / `realtime`).
- [ ] Define cache TTL and invalidation owner.
- [ ] Define max initial payload budget (`maxInitialPayloadKb`) and hydration boundary.
- [ ] Use bounded data fetches (explicit `limit`, stable cursor for lists).
- [ ] Ensure no duplicate fetch between metadata and page body.

## Guardrails

- [ ] `npm run check:page-contract`
- [ ] `npm run check:force-dynamic-allowlist`
- [ ] `npm run check:e2e:perf`
- [ ] `npm run check:route-baseline-regression`

## Generator

Generate a starter contract entry:

```bash
npx tsx scripts/generate-page-performance-contract.ts /your/new/route
```
