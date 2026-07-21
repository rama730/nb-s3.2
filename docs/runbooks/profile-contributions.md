# Profile contributions: authority, operations, and repair

This runbook defines the production contract for the profile contribution ecosystem. The normalized relational model is authoritative. `profiles.experience` is compatibility data only and must never be read or written as a contribution source.

## Field ownership matrix

| Concern | Authority | User-editable | Notes |
| --- | --- | --- | --- |
| Platform project identity, title, slug, and URL | `projects` | No | Read through the project relation; do not copy mutable project identity into profile JSON. |
| Platform membership lifecycle and membership role | project owner/member/application lifecycle | No | Membership upsert/end commands create and close the normalized contribution and role history. |
| Platform display role | shared `formatProjectTeamRole` policy | No | Uses the same `Lead / focus` and member-role terminology as the project team card. |
| Contribution summary, skills, repository, start/end display months | `profile_project_contributions` | Yes | Changed only through the typed contribution batch command. |
| Public/private visibility | `profile_project_contributions.visibility` | Yes | One parent switch. Stage visibility is only a compatibility mirror. |
| External project identity and presentation | `profile_project_contributions` with `project_id IS NULL` and stable `external_key` | Yes | External contributions may be created, edited, and deleted by the profile owner. |
| Canonical skills | `profile_contribution_skills` joined to `skills` | Yes | The JSON label array is a compatibility projection, not the read authority. |
| Role history | `profile_project_contribution_stages` | No in profile editor | Bounded history created by membership/application lifecycle events. |
| Mutation history and retry identity | `profile_audit_events` | No | One unique audit row per user and idempotency key. |

## Forty-two-point closure map

| # | Approved improvement | Implemented control |
| ---: | --- | --- |
| 1 | Normalized tables are authoritative | Contribution, stage, skill-assignment, and audit tables own runtime state; profile JSON is compatibility-only. |
| 2 | Explicit field ownership | The field ownership matrix above separates lifecycle, identity, presentation, visibility, and history. |
| 3 | Typed discriminated model | Strict `platform`, `external`, and `external-delete` command variants reject unknown fields. |
| 4 | Normalize external contributions | External rows use `project_id IS NULL`, a stable external key, title, URLs, and optimistic version. |
| 5 | One visibility authority | Only the parent contribution controls presentation; stage visibility is a compatibility mirror. |
| 6 | One active-date rule | Month inputs normalize to UTC boundaries and closing lifecycle events supply the end date. |
| 7 | Defined missing-entry semantics | Omitting a platform contribution is unchanged, while external deletion requires an explicit command. |
| 8 | Duplicate prevention | Partial unique indexes and batch validation reject duplicate platform and external identities. |
| 9 | Shared team-role terminology | Profile contributions reuse the project team-card role formatter. |
| 10 | Canonical skill authority | Reads use relational skill assignments rather than contribution JSON. |
| 11 | Lossless legacy-skill migration | Known and previously unknown labels are cataloged and assigned before relational reads become exclusive. |
| 12 | Retire unused presentation branches | Legacy experience reads, stage editing, legacy skill fallback, and retired highlight/status branches are removed from runtime presentation. |
| 13 | Dedicated commands | Contribution mutations use one authenticated, rate-limited server action. |
| 14 | Transactional writes | Contribution rows, skills, audit identity, and cache invalidation commit together. |
| 15 | Optimistic concurrency | Every persisted edit/delete compares `expectedVersion`; conflicts preserve the draft. |
| 16 | Strict validation | Batch size, dates, URLs, UUIDs, skills, duplicates, and unknown keys are validated before SQL. |
| 17 | Immutable platform fields | Project identity, role, and membership lifecycle cannot be rewritten by the profile editor. |
| 18 | Strip private legacy JSON | General profile updates and account export no longer treat experience JSON as contribution data. |
| 19 | Parent-derived RLS | Contribution, stage, and skill public policies derive access from the parent and project visibility. |
| 20 | Idempotent audited retries | A unique user/idempotency-key audit row prevents mutation replay and records batch completion. |
| 21 | Purpose-specific SQL | Portfolio, paginated contribution, bounded stage, skill, and count reads are separated. |
| 22 | Privacy-first reads | Profile visibility is resolved before contribution work; owner/private and public paths are distinct. |
| 23 | Remove duplicate experience reads | Browser hydration, profile data, account export, and profile UI consume the normalized source only. |
| 24 | Set-based reconciliation | Skill assignments are replaced in one batched synchronization instead of serial per-item work. |
| 25 | One invalidation per save | Each batch marks the affected collaboration summary stale once. |
| 26 | Stampede protection | Public summary reads are request-deduplicated and version-cache guarded. |
| 27 | Owner request deduplication | Repeated identical owner reads share in-flight work without entering public cache. |
| 28 | Bounded history | Stage history has an enforced per-contribution limit. |
| 29 | Correct count and cache semantics | Count, page, `hasMore`, cache version, and stale behavior use the normalized query. |
| 30 | Remove the duplicate stage editor | The profile editor owns one parent-level visibility and presentation form; the old endpoint returns 410. |
| 31 | Private owner preview | Private rows remain visible to their owner with an explicit Private status. |
| 32 | Complete UI states | Loading, empty, private, saving, validation, conflict, and failure states are explicit. |
| 33 | Paginated editor list | The editor loads 50 rows at a time, caps one session at 500, and appends without losing drafts. |
| 34 | Accessible accordion | Stable IDs, `aria-expanded`, focusable controls, and one expanded contribution reduce complexity. |
| 35 | Descriptive platform fields | Platform-owned identity and role render as read-only definitions instead of disabled editable inputs. |
| 36 | Per-item draft state | Dirty, private, saving, attention, and field-error states remain attached to each contribution. |
| 37 | Database integration contract | A disposable-only rollback test verifies constraints, indexes, policies, and concurrency. |
| 38 | Visibility E2E matrix | Browser coverage verifies owner private preview, public hiding, and public reveal. |
| 39 | Lifecycle contract coverage | Unit and migration checks protect platform retention and membership-owned lifecycle behavior. |
| 40 | Concurrency and failure behavior | Version conflicts, idempotent retries, partial general-profile success, and draft retention are defined and tested. |
| 41 | RLS and performance gates | RLS, SQL governance, page limits, in-flight dedupe, cache controls, and static drift checks run in CI commands. |
| 42 | Drift detection and repair operations | The inspection queries, repair order, metrics, alerts, and safe rollout procedure below close operations. |

## Invariants

1. Every active contribution is exactly one of: a platform row with `project_id`, or an external row with `external_key` and `project_title`.
2. A profile can have one active platform row per project and one active external row per external key.
3. `version` is positive and every edit/delete compares the caller's expected version.
4. Platform identity, lifecycle, and role cannot be changed by the profile editor.
5. Removing a platform row from a client payload means unchanged; it never deletes a membership contribution.
6. New external rows default to private in the editor.
7. Public reads require a public parent contribution and, for platform rows, a public/unlisted non-draft project.
8. Owners can preview private rows with an explicit Private indicator.
9. Dates are UTC month boundaries and `ended_at` cannot precede `started_at` at the command boundary.
10. URLs are limited to safe public HTTP(S) locations.

## Deployment and backfill

1. Deploy migration `0127_profile_contribution_authority.sql` before application code that writes external rows.
2. The migration adds the discriminating identity fields and version, normalizes safe legacy presentation data, creates external rows for valid legacy entries, resolves known skill labels, mirrors parent visibility to stages, hardens read policies, marks summary caches stale, removes duplicate historical retry rows, and creates the idempotency index.
3. Run `pnpm check:db:migration-journal`, `pnpm check:db:migration-sources`, `pnpm check:sql-governance`, `pnpm check:rls-contract`, and `pnpm check:profile-contributions` before rollout.
4. Point `E2E_DATABASE_URL` (or `DATABASE_URL_FRESH`) at the migrated disposable database and run `pnpm check:profile-contributions:db`. The integration check refuses to use the primary `DATABASE_URL`, rolls its fixture mutation back, and verifies installed constraints, indexes, parent-derived policies, and optimistic concurrency.
5. After applying the migration, rebuild stale collaboration summaries lazily through normal reads. Do not perform a global synchronous cache rebuild during deployment.

## Read-only drift inspection

Use these checks before attempting repair:

```sql
-- Invalid authority shape (expected: zero rows)
SELECT id, profile_id, project_id, external_key, project_title
FROM profile_project_contributions
WHERE deleted_at IS NULL
  AND NOT (
    (project_id IS NOT NULL AND external_key IS NULL)
    OR (project_id IS NULL AND external_key IS NOT NULL AND NULLIF(BTRIM(project_title), '') IS NOT NULL)
  );

-- Duplicate active identities (expected: zero rows)
SELECT profile_id, project_id, count(*)
FROM profile_project_contributions
WHERE deleted_at IS NULL AND project_id IS NOT NULL
GROUP BY profile_id, project_id HAVING count(*) > 1;

SELECT profile_id, external_key, count(*)
FROM profile_project_contributions
WHERE deleted_at IS NULL AND project_id IS NULL
GROUP BY profile_id, external_key HAVING count(*) > 1;

-- Stage visibility drift (expected: zero rows)
SELECT stage.id, stage.contribution_id
FROM profile_project_contribution_stages stage
JOIN profile_project_contributions contribution ON contribution.id = stage.contribution_id
WHERE stage.deleted_at IS NULL
  AND stage.visibility IS DISTINCT FROM contribution.visibility;

-- Skill compatibility labels that have no relational assignment
SELECT contribution.id, contribution.skills
FROM profile_project_contributions contribution
WHERE contribution.deleted_at IS NULL
  AND jsonb_array_length(COALESCE(contribution.skills, '[]'::jsonb)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM profile_contribution_skills assignment
    WHERE assignment.contribution_id = contribution.id
  );
```

## Repair procedure

1. Stop profile contribution writes only if invalid or duplicate authority rows are present. Ordinary skill or stage drift does not require a full application outage.
2. Export the affected contribution, stage, skill-assignment, and audit rows before repair.
3. For duplicate platform rows, keep the row referenced by the newest valid lifecycle event, merge user presentation fields deliberately, soft-delete the other row, and retain an audit record. Never hard-delete membership evidence.
4. For duplicate external rows, keep the highest valid version/newest row, merge only with explicit owner approval if user content differs, and soft-delete the duplicate.
5. Repair stage visibility from the parent contribution. Do not repair the parent from a stage.
6. Resolve skill labels through the canonical skills service and replace the full assignment set transactionally.
7. Mark only affected profile summaries stale, then re-run all drift queries and the contract checks.
8. If repair changes visible content, notify the affected user and retain the before/after snapshot in `profile_audit_events`.

## Observability and alerts

Track `profile.contributions.save`, `profile.collaboration.contributions`, and `profile.collaboration.summary` with counts split by success/error code, cache status, owner/public read, page size, and duration. Do not log summaries, URLs, skill free text, or private contribution contents.

Alert when any of the following occurs:

- conflict rate exceeds 5% for 15 minutes;
- save failures exceed 1% for 10 minutes;
- p95 contribution read exceeds 250 ms or save exceeds 500 ms;
- cache misses exceed 40% for public summaries for 15 minutes;
- page/stage limits are repeatedly saturated, which signals a pagination UX or abuse problem;
- any authority, duplicate, visibility, or RLS drift check returns a row.

## Failure behavior

- Validation failures preserve the local draft and focus the affected control.
- Version conflicts preserve the draft and require a fresh authoritative reload before retry.
- A general-profile save may complete before a contribution save fails; the modal updates its general-profile base so retrying cannot duplicate the first write.
- Idempotent retry returns success without replaying mutations.
- The retired stage endpoint returns `410 NOT_SUPPORTED` so stale clients cannot reintroduce a second visibility authority.

## Capacity contract

- Maximum 50 mutations per batch, 20 skills per contribution, 50 contribution rows per page, 20 role-history rows per contribution, and 10 editor pages (500 rows) per open session.
- Public summaries use request deduplication and a versioned cache; owner/private reads bypass shared public cache content.
- The editor renders one expanded contribution at a time and fetches pages incrementally, preventing all-project/all-stage DOM expansion.
