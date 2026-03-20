# ADR: Workspace Profile Counters

## Decision

Workspace bootstrap counts are read from denormalized columns on `profiles`:

- `workspace_inbox_count`
- `workspace_due_today_count`
- `workspace_overdue_count`
- `workspace_in_progress_count`

## Why

- Workspace shell bootstraps must stay O(1).
- Live `count(*)` aggregates in hot bootstrap paths do not hold up under reconnect storms or wide concurrency.
- The existing `profiles` denormalization pattern is simpler than introducing new read-model tables.

## Consequences

- Mutation paths refresh counters on write.
- Reconciliation remains secondary drift repair, not the primary data path.
- CI forbids reintroducing live aggregate counts into `getWorkspaceOverviewBase`.
