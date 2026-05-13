# Files Tab Property-Based Tests

Home for the four property-based tests (PBTs) mandated by the Files Tab GitHub
Redesign spec (`design.md` § Correctness Properties).

## Runner

These tests use the project's existing unit-test harness:

- Test runner: `tsx --test` (Node's built-in `node:test` under `tsx`)
- Property-based testing library: [`fast-check`](https://fast-check.dev/) v4
- Invocation: picked up automatically by `npm run test:unit` via the glob
  `tests/unit/**/*.test.ts`

Import `fast-check` with the default export:

```ts
import fc from "fast-check";
```

## `numRuns` requirement

Every `fc.assert(...)` call in this folder MUST pass `{ numRuns: 100 }` (or
higher) in its parameters object. This matches the tasks spec (Tasks 2.7–2.10)
and the requirement traceability matrix in `design.md`.

```ts
fc.assert(
  fc.property(someArbitrary, (value) => {
    /* invariant */
  }),
  { numRuns: 100 },
);
```

Do NOT lower `numRuns` below 100 for the four mandated properties:

1. `tree-breadcrumb-sync.test.ts` — Property 1
2. `metadata-matches-selection.test.ts` — Property 2
3. `url-state-roundtrip.test.ts` — Property 3
4. `navigation-refresh-consistency.test.ts` — Property 4

## Annotating requirements

Per the tasks guideline, every property test must declare the requirements it
validates inline using the exact format:

```
**Validates: Req 3.1, 3.2, 6.1**
```

Place the annotation in a comment or `describe` block title immediately above
the `fc.assert` invocation.
