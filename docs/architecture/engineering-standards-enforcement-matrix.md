# Engineering Standards Enforcement Matrix

Last updated: 2026-04-08

This matrix maps the standards registry to docs, CI scripts, rollout stage, and exception handling.

Typed source of truth:
- [rules.ts](/Users/chrama/Downloads/nb-s3/src/lib/standards/rules.ts)

## Rule Matrix

| Rule ID | Standard | Severity | Owner | Current Stage | Primary Enforcement | Escalation Path | Exception Path |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `NB-ARCH-001` | Route and page contracts | Critical | Architecture | Blocking | `check:page-contract`, `check:force-dynamic-allowlist` | Block merge and release if route contract is missing or mismatched | Existing allowlists only |
| `NB-ARCH-002` | Runtime plane separation | Critical | Architecture | Blocking | `check:runtime-boundaries` | Block merge if request/realtime/worker boundaries are crossed | Time-bounded standards exception with rollback |
| `NB-CON-001` | Canonical logic reuse | Critical | Platform | Blocking | `check:canonical-logic-contract` | Block merge for new duplicate avatar/fallback logic or non-canonical first-wave surfaces | Time-bounded exception plus removal task |
| `NB-DATA-001` | Normalized surface boundaries | High | Platform | Report only | `check:data-shape-contract` | Warn on legacy snake_case UI surfaces; promote to blocking in Phase 2 | Allowlist entry tied to migration task |
| `NB-DB-001` | SQL governance | Critical | Data | Blocking | `check:sql-governance`, DB replay/remigration checks | Block merge on new unapproved SQL assets or unexpected migration files | Manifest break-glass approval with expiry |
| `NB-OPS-001` | High-risk impact review | High | Architecture | Report only | `check:impact-review` | Warn when high-risk paths lack a machine-readable review; promote to blocking in later phases | Impact-review exception with owner and expiry |
| `NB-SCALE-001` | Evidence-based scale claims | Critical | QA | Blocking | stability release, load, capacity, rollout, and `check:1m-readiness` | Block readiness claims and rollout if proof chain is incomplete | No exception for production-ready claims |
| `NB-DEBT-001` | Lean complexity budget | High | Platform | Blocking | `check:review-guardrails`, release-gate review | Block merge for forbidden guardrail patterns and unjustified complexity | Explicit written justification and rollback path |

## Phase Rollout

### Phase 1

- Block on canonical identity/avatar reuse in the first-wave surfaces.
- Block on SQL-governance violations.
- Report on remaining raw shape debt in UI components.
- Report on missing impact reviews unless strict CI passes changed paths explicitly.

### Phase 2

- Move `NB-DATA-001` to blocking for first-wave surfaces.
- Require strict `check:impact-review` for production-bound and break-glass changes.
- Remove legacy allowlist entries as surfaces migrate to normalized view models.

### Phase 3

- Block on all high-risk impact-review gaps.
- Reduce legacy data-shape allowlist to zero.
- Keep new work permanently on canonical logic paths.

## Required Evidence By Change Type

| Change type | Required evidence |
| --- | --- |
| New page or route contract | page contract, force-dynamic allowlist, perf checks, route baseline regression |
| API or server action change | API contract checks, impact review when high-risk, observability and rollback note |
| Realtime or worker change | runtime-boundary checks, impact review, load/reconnect evidence when hot |
| Schema or SQL change | SQL governance, migration journal, replay/remigration checks, break-glass approval if needed |
| Cross-surface UX logic | canonical logic contract, unit tests for the shared helper/view model, cross-surface consistency coverage |

## Active Canonical Modules

- Identity/avatar presentation: [identity.ts](/Users/chrama/Downloads/nb-s3/src/lib/ui/identity.ts) and [UserAvatar.tsx](/Users/chrama/Downloads/nb-s3/src/components/ui/UserAvatar.tsx)
- Status/lifecycle config: [status-config.ts](/Users/chrama/Downloads/nb-s3/src/lib/ui/status-config.ts)
- Profile display defaults: [display.ts](/Users/chrama/Downloads/nb-s3/src/lib/profile/display.ts) and [normalize-profile.ts](/Users/chrama/Downloads/nb-s3/src/lib/utils/normalize-profile.ts)
- Relationship actions: [person-card-model.ts](/Users/chrama/Downloads/nb-s3/src/components/people/person-card-model.ts)
- Import filters: [import-filters.ts](/Users/chrama/Downloads/nb-s3/src/lib/import/import-filters.ts)
