# E2E Route/Module Coverage Matrix

## Coverage Exit Condition
- 100% of user routes in `src/app/**/page.tsx` mapped to at least one E2E test.
- Each mapped route/module has:
  - 1 functional assertion path.
  - 1 runtime monitoring assertion path (console/pageerror/http hygiene).

## Routes Matrix

| Route | Surface | Owning Spec(s) | Fixture Dependency | Functional Assertions | Monitoring Assertions |
|---|---|---|---|---|---|
| `/` | Landing | `tests/e2e/auth-landing-matrix.spec.ts` | None | Hero CTA links and auth navigation | No pageerror, no unexpected 5xx |
| `/login` | Auth | all specs via helper login | E2E user creds | Sign-in succeeds and redirects | No runtime exceptions during auth submit |
| `/signup` | Auth | `tests/e2e/auth-landing-matrix.spec.ts` | Existing email fixture | Duplicate-email error and no infinite loading | No pageerror / no unexpected 5xx |
| `/onboarding` | Onboarding | `tests/e2e/onboarding-smoke.spec.ts` | Onboarding fixture users | happy path, reserved/collision/rate limit/idempotency | No uncaught exception, endpoint hygiene |
| `/hub` | Hub | `tests/e2e/hub-cursor-integrity.spec.ts`, `tests/e2e/project-views-follows.spec.ts` | Seeded projects | list render, pagination integrity, follow/unfollow | no duplicate cards, no 5xx |
| `/messages` | Messages | `tests/e2e/messaging-smoke.spec.ts`, `tests/e2e/application-flow-smoke.spec.ts`, `tests/e2e/messages-tabs-matrix.spec.ts` | Seeded conversations/apps | chats/applications/projects tabs and composer actions | no runtime/network violations |
| `/people` | Connections | `tests/e2e/connections-smoke.spec.ts`, `tests/e2e/people-matrix.spec.ts` | Seeded profile graph | discover/network/requests coverage | no runtime/network violations |
| `/profile` | Owner profile | `tests/e2e/profile-edit-flow.spec.ts` | E2E user profile | edit persists and reflects on page | no runtime exceptions |
| `/u/[username]` | Public profile | `tests/e2e/public-profile-matrix.spec.ts` | E2E username from profile | public profile loads and key modules render | no pageerror/no 5xx |
| `/projects/[slug]` | Project detail | `tests/e2e/project-views-follows.spec.ts`, `tests/e2e/files-tab-smoke.spec.ts`, `tests/e2e/project-tabs-matrix.spec.ts` | Seeded fixture project | dashboard/sprints/tasks/analytics/files assertions | no runtime/network violations |
| `/workspace` | Workspace | `tests/e2e/workspace-matrix.spec.ts` | Workspace overview data | all six tabs + tab persistence | no runtime/network violations |
| `/settings` | Settings home | `tests/e2e/settings-matrix.spec.ts` | Auth only | card navigation to all sub-routes | no runtime exceptions |
| `/settings/account` | Settings account | `tests/e2e/settings-matrix.spec.ts` | Auth + admin optional | export/signout/delete guard and reserved username UI | no runtime/network violations |
| `/settings/security` | Settings security | `tests/e2e/settings-matrix.spec.ts` | Auth | password validation/sessions visibility | no runtime/network violations |
| `/settings/privacy` | Settings privacy | `tests/e2e/settings-matrix.spec.ts` | Auth | privacy toggles and persistence check | no runtime/network violations |
| `/settings/notifications` | Settings notifications | `tests/e2e/settings-matrix.spec.ts` | Auth | autosave toggles and save indicator | no runtime/network violations |
| `/settings/appearance` | Settings appearance | `tests/e2e/settings-matrix.spec.ts` | Auth | theme/density controls render + update | no runtime/network violations |
| `/settings/integrations` | Settings integrations | `tests/e2e/settings-matrix.spec.ts` | Auth | integrations panel render | no runtime/network violations |

## Module Matrix

| Module | Owning Spec(s) | Coverage Focus |
|---|---|---|
| Messages tabs (chats/applications/projects) | `messaging-smoke`, `application-flow-smoke`, `messages-tabs-matrix` | tab parity, state transitions, send + empty-state handling |
| People tabs (discover/network/requests) | `connections-smoke`, `people-matrix` | list quality, actions, request lifecycle |
| Project tabs (dashboard/sprints/tasks/analytics/files) | `project-tabs-matrix`, `files-tab-smoke` | navigation stability + core workflows |
| Workspace tabs (overview/tasks/inbox/projects/notes/activity) | `workspace-matrix` | tab routing, persistence, baseline actions |
| Settings modules | `settings-matrix` | route completeness + control stability |

## Fixture Contract
- All fixture-seeded data is tagged with run context (`E2E_RUN_ID`) where supported.
- Seed before suite (`globalSetup`) and best-effort cleanup after suite (`globalTeardown`).
- Destructive tests execute only against fixture-scoped users/projects.
