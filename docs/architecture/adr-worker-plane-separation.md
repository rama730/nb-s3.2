# ADR: Worker Plane Separation

## Decision

Git sync and project import execution are registered only on the worker deployment through `INNGEST_EXECUTION_ROLE=worker`.

## Why

- Heavy repository cloning and sync work must not compete with web request serving.
- The boundary needs to be enforced at function registration time, not only through worker budget checks.
- A separate worker deployment gives clearer capacity and rollout control.

## Consequences

- The web deployment registers no worker functions.
- Runtime guardrails in [worker-guard.ts](/Users/chrama/Downloads/nb-s3/src/lib/github/worker-guard.ts) remain important, but they are no longer the only isolation boundary.
- Capacity audit and rollout artifacts must track the worker plane separately.
