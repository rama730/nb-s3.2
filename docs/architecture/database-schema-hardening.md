# Database Schema Hardening Plan (Implemented + Next)

## Core entity ownership model

- `projects` is the ownership root for workspace/runtime/task trees.
- Child entities that should not outlive the project now use `ON DELETE CASCADE` consistently:
  - `tasks.project_id`
  - `project_nodes.project_id`
  - `project_run_profiles.project_id`
  - `project_run_sessions.project_id`
  - `project_run_logs.project_id`
  - `project_run_diagnostics.project_id`
  - `project_skills.project_id`
  - `project_tags.project_id`

## Relationship and FK hardening

Implemented in `0042_schema_hardening_constraints_and_fks.sql`:

- Added missing FK for `role_applications.creator_id -> profiles.id`.
- Replaced `NO ACTION` ownership FKs with `CASCADE` where lifecycle-coupled.
- Kept optional/history links as `SET NULL` where entity snapshots should survive.

## New invariants

Implemented as `NOT VALID` checks (safe rollout, enforced for new writes):

- `connections_no_self_check`: requester cannot equal addressee.
- `project_open_roles_count_non_negative_check`
- `project_open_roles_filled_non_negative_check`
- `project_open_roles_filled_lte_count_check`
- `project_nodes_no_self_parent_check`

## Indexes and scale posture

Implemented:

- `project_nodes_project_path_idx (project_id, path)`
- `project_nodes_project_parent_updated_idx (project_id, parent_id, updated_at)`

Conditional unique indexes with duplicate-safe rollout:

- `project_nodes_active_parent_name_uidx` (active node names scoped by project/parent)
- `project_nodes_active_project_path_uidx` (active path uniqueness per project)
- `connections_active_pair_uidx` (canonical active pair uniqueness)

These are created only when duplicate data is absent, preventing hard migration failures in legacy environments.

## Migration governance

Implemented:

- Canonical migration drift gate: `scripts/check-migration-journal.ts`
- CI script entry: `npm run check:db:migration-journal`
- Journal updated to include all current migration SQL files.

## Normalized vs JSONB consistency policy

Current direction:

- Keep JSONB columns for flexible UX payloads.
- Keep normalized tables (`project_skills`, `project_tags`, `profile_skills`, `profile_interests`) as query source for relational joins and analytics.

Recommended next step:

- Add deterministic write policy in service layer:
  - update normalized tables first
  - derive JSONB denormalized mirrors from normalized source in same transaction

## Next enhancements for long-term scale

- Add optimistic concurrency version columns on high-contention rows (`project_nodes`, `tasks`, `messages`).
- Evaluate partitioning for append-heavy audit/log tables (`project_node_events`, `project_run_logs`, `project_run_diagnostics`) by time.
- Add migration lint checks for:
  - unqualified relation references in `SECURITY DEFINER` / empty `search_path` functions
  - missing explicit `ON DELETE` policy on new FKs.
