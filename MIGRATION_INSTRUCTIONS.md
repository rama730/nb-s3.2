# Database Migration Instructions

This project now uses `project_nodes`-based files workspace tables and forward-only Drizzle SQL migrations.

## 1) Apply migrations (canonical path)

Run from repo root:

```bash
npm run check:db:migration-journal
npm run db:push
```

For environments where `db:push` is restricted, apply SQL files in `drizzle/` sequentially via Supabase SQL Editor.

## 2) Required hardening migrations

These migrations must be present in target environments:

- `0033_onboarding_username_guardrails.sql`
- `0041_username_rules_schema_qualification.sql`
- `0042_schema_hardening_constraints_and_fks.sql`
- `0043_project_files_key_policy_dual_read.sql`
- `0044_onboarding_profile_extended_preferences.sql`

They fix:

- username trigger schema qualification (`public.reserved_usernames`)
- FK `ON DELETE` policy consistency for project ownership trees
- new integrity checks (`connections`, `project_open_roles`, `project_nodes`)
- new scale indexes for `project_nodes`
- dual-read/canonical-write `project-files` storage policy alignment
- onboarding preference columns and constraints (`experience_level`, `hours_per_week`, `gender_identity`, `pronouns`)

## 3) Post-migration verification

Run:

```bash
npm run check:db:migration-journal
npm run seed:e2e:fixtures
npm run cleanup:e2e:fixtures
```

Then execute smoke coverage:

```bash
npx playwright test tests/e2e/files-tab-smoke.spec.ts tests/e2e/project-tabs-matrix.spec.ts
```

## 4) Quick SQL validation snippets

```sql
-- Username guardrail function should reference public.reserved_usernames
select pg_get_functiondef('public.enforce_profile_username_rules'::regproc);

-- Integrity checks should exist
select conname
from pg_constraint
where conname in (
  'connections_no_self_check',
  'project_open_roles_count_non_negative_check',
  'project_open_roles_filled_non_negative_check',
  'project_open_roles_filled_lte_count_check',
  'project_nodes_no_self_parent_check'
);

-- FK behavior should be cascade for ownership tree tables
select conname, confdeltype
from pg_constraint
where conname in (
  'tasks_project_id_projects_id_fk',
  'project_nodes_project_id_projects_id_fk',
  'project_run_profiles_project_id_projects_id_fk',
  'project_run_sessions_project_id_projects_id_fk'
);
```

`confdeltype = 'c'` means `ON DELETE CASCADE`.

## 5) Onboarding draft cleanup plan (target: June 30, 2026)

- Keep dual local draft read support (`onboarding:draft:v2` + legacy `onboarding:draft:v1`) during the transition window.
- Emit onboarding telemetry (`draft_loaded`) with `localDraftSource` to measure remaining `v1` usage.
- After `v1` reads are <1% for 14 consecutive days, remove `v1` read fallback in code.
- Keep new profile preference columns (`experience_level`, `hours_per_week`, `gender_identity`, `pronouns`) as canonical; do not introduce alternate legacy fields.
