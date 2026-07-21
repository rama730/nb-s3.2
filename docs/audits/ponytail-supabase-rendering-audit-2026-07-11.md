# Ponytail Supabase and Rendering Audit

Date: 2026-07-11
Workspace: `/Users/chrama/Downloads/nb-s3`
Supabase project: `iutauehhgdymtpzrnzcy`
Mode: original read-only audit, followed by implementation closure on 2026-07-11.

## Implementation Closure Addendum

Implementation status: code-side, migration-side, and live Supabase catalog items that can be safely implemented from this workspace have been completed. The product page inventory is now 18 routable pages, not 25, because sprint detail is no longer a standalone page and settings sections now live under one `/settings` tabs page. Two provider-controlled items remain outside repo/Supabase-SQL authority: `track_functions` requires a higher-privilege Supabase setting path, and native leaked-password protection requires the Supabase Auth dashboard/plan support.

Validation after implementation:

- `npm run build`: PASS.
- `npm run check:page-contract`: PASS, 18 pages and 18 contracts.
- `npm run check:runtime-boundaries`: PASS.
- `npm run check:query-key-contract`: PASS.
- `npm run check:realtime-origin-contract`: PASS.
- `npm run check:build-rendering-contract`: PASS, 18 page contracts verified against production manifests.
- `npm run check:sql-governance`: PASS, 125 migrations and 1 utility SQL file.
- `npm run check:rls-contract`: PASS.
- `npm run check:db-catalog-drift`: PASS.

Additional verification on 2026-07-11:

- `npm run build`: PASS after the final messages-page runtime shrink.
- Live Supabase `SHOW track_functions`: `none`.
- Live Supabase `pg_stat_user_functions`: empty.
- Attempted `ALTER DATABASE postgres SET track_functions = 'pl'` through Supabase migration API: blocked by Supabase with `permission denied to set parameter "track_functions"`. No unappliable local migration was kept.
- Native Supabase Auth leaked-password protection is still provider/dashboard controlled from this toolset; the app-level fallback remains implemented for signup, password change, and recovery reset.
- `node --test --import tsx tests/unit/messaging-unread-contract.test.ts`: PASS, including the messages runtime-gating contract.
- `node --test --import tsx tests/unit/leaked-password.test.ts`: PASS.

Live Supabase changes applied:

- `project-files` and `task-files` buckets now have 10 MB size limits and explicit MIME allowlists.
- `project-updates-media` remains intentionally public, is image-only, and has a 100 MB size limit.
- `comment_mentions`, `message_attachments`, `message_edit_logs`, and `message_workflow_items` were removed from the `supabase_realtime` publication because no current browser subscription path uses them.

Implementation checklist:

| Item | Status |
|---|---|
| ADD-01 sprint detail route removal | Done. The compatibility page was deleted and sprint state stays on `/projects/{slug}?tab=sprints&sprintId={id}`. |
| ADD-02 settings route consolidation | Done. `/settings` owns account, security, privacy, notifications, appearance, and integrations as query-param tabs. |
| ADD-03 confusing-but-valid routes | Kept. `/projects/new`, `/u/[username]`, `/admin/notifications`, and `/` remain separate by product role. |
| P0-01 hub project card prefetch | Done. Project cards no longer viewport-prefetch detail pages. |
| P0-02 settings nav prefetch | Done. Settings tab links use `/settings?tab=...` with prefetch disabled. |
| P0-03 global runtime work | Done. Chat/people runtime work is route-gated and notification realtime is consolidated. |
| P0-04 presence heartbeat feedback | Done. `last_active_at`-only profile events are ignored and heartbeat writes are timestamp-guarded. |
| P0-05 project detail hidden tabs | Done. Inactive project tabs unmount instead of staying hidden. |
| P0-06 analytics duplicate fetches | Done. Analytics data loads by active subtab. |
| P0-07 hydration polling | Done. Polling now runs only while hydration is active. |
| P0-08 missing mutual-connections RPC | Done. Dead RPC fallbacks were removed. |
| P0-09 duplicate notification channel | Done. One user-notification realtime stream fans out locally. |
| P1-10 repeated auth/action bundle work | Done for app-owned code. Profile connection/profile actions now lazy-load on click; full JWKS behavior remains Supabase/library-runtime managed rather than wrapped in another app abstraction. |
| P1-11 top-nav prefetch | Done. Profile and logo links disable default prefetch. |
| P1-12 JS payload budget enforcement | Done. The build checker now validates initial route entry JS against contracts and excludes async modal chunks. |
| P1-13 stale route baselines | Done for route contracts/build baselines. Route inventory/baseline contracts now match 18 pages; full authenticated browser trace regeneration is an environment validation step when a stable test account/session is available. |
| P1-14 storage policy drift checker | Done. Drift checker matches hardened policy names and bucket contract decisions. |
| P1-15 realtime publication/channel cap | Done. Unused publication tables were removed and route runtime work was capped. |
| P1-16 project-files MIME restriction | Done locally and in live Supabase. |
| P1-17 project-updates-media decision | Done. It remains public by decision, image-only, with explicit bucket assertions. |
| P1-18 zero-scan indexes | No bulk drop by design. The report explicitly required evidence windows before deletion. |
| P1-19 function stats | Blocked externally. Live Supabase reports `track_functions = none`; attempting `ALTER DATABASE postgres SET track_functions = 'pl'` through the Supabase migration API failed with `permission denied to set parameter "track_functions"`. |
| P1-20 SECURITY DEFINER audit | Done. Drift checker allowlists and verifies the two expected SECURITY DEFINER functions. |
| P1-21 leaked password protection | App fallback done; native toggle remains external. Signup, password change, and recovery reset use the app password-safety fallback; Supabase's native leaked-password protection must be enabled in the Supabase Auth dashboard if the plan supports it. |
| P1-22 RLS no-policy tables | Done. Intentional fail-closed tables are allowlisted in catalog drift checks. |
| P1-23 task detail hidden tabs | Done. Inactive task tab panels unmount. |
| P1-24 messages high commit count | Done for app-owned shrink/instrumentation. Messages now gate chat inbox loading, inbox realtime, and list typing by the active Chats tab; active-thread realtime runs only when a conversation is selected; optional render profiling and dev realtime-channel traces are available through `NEXT_PUBLIC_MESSAGES_RENDER_PROFILER=1` and `NEXT_PUBLIC_MESSAGES_REALTIME_TRACE=1`. |
| P1-25 settings/security bundle | Done. Heavy security sections lazy-load behind the active settings tab. |
| P2-26 task duplicate HEAD/GET | Done. Task resource counts no longer duplicate subtasks/files HEAD calls. |
| P2-27 React Strict Mode | Kept. No change; dev-only double effects should remain labeled separately. |
| P2-28 migration registry mismatch | Documented. Drizzle/app migration journal remains authoritative; Supabase migrations were applied with matching names for live catalog closure. |
| P2-29 storage reconciliation | Done. Reconciliation now compares distinct storage keys. |
| P2-30 DB cron/net workers | No change required. No app-owned DB cron/net workers were found. |

## Scope

This audit covers:

- Entire application page and tab inventory.
- Page/tab render triggers, duplicate render causes, realtime channels, polling, prefetching, and background work.
- Supabase database catalog: schemas, tables, views, functions, triggers, policies, RLS, roles, enum types, extensions, indexes, storage buckets, realtime publications, replication slots, logs, and advisors.
- Ponytail review layer: unnecessary work, duplicate layers, speculative or stale checks, and places where deletion or a smaller native feature is the simplest fix.

Important boundary: the Ponytail audit skill is specifically about over-engineering. Rendering performance, database safety, RLS correctness, and operational advice below are normal engineering review findings, included because the requested scope requires them.

## Executive Result

The application is not suffering from one single backend defect. The main speed and duplicate-work risk is a combination of:

1. Default Next.js prefetches still active on high-fanout links.
2. Main authenticated layout mounting global providers on every main route.
3. Project detail keeping previously visited tabs mounted in the background.
4. Analytics fetching more datasets than the active analytics tab needs.
5. A live 5-second hydration poll against `projects.import_source`.
6. A missing `get_mutual_connections` RPC that code still calls and silently swallows.
7. Performance budgets documented but not enforced against real JS payload size.
8. Supabase advisor noise from zero-scan indexes that should be reviewed carefully, not bulk-dropped.
9. A stale catalog drift checker expecting storage policies that were deliberately renamed by the later hardening migration.
10. A product-routing cleanup is needed: sprint detail is still represented by a compatibility page, and settings sections are still modeled as separate pages instead of one tabbed settings surface.

No exact duplicate app trigger group, duplicate app policy group, duplicate app function body, invalid index, missing foreign-key covering index, or uncontrolled database cron/net background worker was found.

## Validation and Evidence

Repo checks already run during the audit:

- `check:page-contract`: PASS, 25 pages and 25 contracts.
- `check:runtime-boundaries`: PASS.
- `check:query-key-contract`: PASS.
- `check:realtime-origin-contract`: PASS.
- `check:force-dynamic-allowlist`: PASS, 9 allowlisted routes.
- `check:build-rendering-contract`: PASS, but only validates route classification, not payload size.
- `check:sql-governance`: PASS, 123 migrations and 1 utility SQL file.
- `check:rls-contract`: PASS.
- `check:db:catalog-drift`: FAIL, because the script expects old `project_updates_media_*` policy names that migration `0122_ponytail_database_hardening.sql` intentionally dropped/replaced.

Supabase checks run during the audit:

- Project details and live catalog queries.
- Live table/catalog inventory.
- Security and performance advisors.
- Recent logs for `api`, `postgres`, `realtime`, `storage`, `auth`, and `edge-function`.
- Function/grant inspection for all `SECURITY DEFINER` functions.
- Index, RLS, policy, trigger, extension, role, enum, FK, storage, realtime, and replication-slot catalog queries.

Browser/runtime checks:

- Production server on isolated port `3001`.
- Authenticated Playwright/browser measurement with React DevTools hook injected before page load.
- Route measurement window: approximately 1.6s after navigation, so commit counts are comparable within this audit but not a lab-grade long-session profiler.

## Page Inventory

Routable pages found: 25.

1. `/authorize`
2. `/forgot-password`
3. `/login`
4. `/reset-password`
5. `/signup`
6. `/verify-email`
7. `/hub`
8. `/messages`
9. `/people`
10. `/profile`
11. `/projects/[slug]`
12. `/projects/[slug]/sprints/[sprintId]`
13. `/projects/new`
14. `/settings/account`
15. `/settings/appearance`
16. `/settings/integrations`
17. `/settings/notifications`
18. `/settings`
19. `/settings/privacy`
20. `/settings/security`
21. `/u/[username]`
22. `/workspace`
23. `/onboarding`
24. `/admin/notifications`
25. `/`

Primary page-level tabs found: 22.

- Project detail: 8 tabs: Dashboard, Docs, Updates, Sprints, Tasks, Analytics, Files, Settings.
- People: 3 tabs: Discover, Network, Requests.
- Messages: 3 tabs: Chats, Applications, Projects.
- Profile: 2 tabs: Overview, Portfolio.
- Settings: 6 routes/tabs: Account, Security, Privacy, Notifications, Appearance, Integrations.

Nested/fixed tab systems found:

- Project analytics: 3 tabs: Overview, Members, Timeline.
- Task detail panel: 5 tabs: Details, Subtasks, Comments, Files, Activity.
- Workspace task detail view: same 5 tabs.
- Edit profile modal: 5 visible tabs: General Properties, Project Contributions, Skills & Expertise, Social Presence, Role Preferences. The type layer also declares `education`, but no visible trigger was found.
- Edit project modal: 5 tabs: Essentials, Details, Stack & Links, Journey, Team & Roles.
- Project doc quick console: up to 7 rail tabs: brief, commands, links, outline, config, options, search.
- Files editor tabs: dynamic and unbounded, one per open file.

Counting repeated tab systems separately, fixed visible tab entries total 52. Counting only primary page-level navigation, the total is 22.

## Route Clarifications and Required Route Consolidation Addendum

This addendum answers the selected route questions and updates the report with the product-level solution. Current inventory remains 25 routable pages until the code is changed. If sprint detail is removed as a page and settings is collapsed from seven settings routes into one `/settings` tabs page, the desired inventory becomes 18 routable pages.

Important route notation:

- Square brackets mean a dynamic URL segment in Next.js. `/projects/[slug]` means a real URL such as `/projects/ponytail`; `/projects/[slug]/sprints/[sprintId]` means a real URL such as `/projects/ponytail/sprints/abc-123`; `/u/[username]` means a real URL such as `/u/rama`.
- The database does not create these pages. The page count comes from Next.js file-system routes. Supabase tables, policies, indexes, triggers, and storage support the data shown on those routes, but the extra page surfaces are created by frontend route files and route contracts.

Selected route meanings:

| Inventory item | Current meaning | Product decision |
|---|---|---|
| 12. `/projects/[slug]/sprints/[sprintId]` | Compatibility/deep-link route only. It immediately redirects to `/projects/{slug}?tab=sprints&sprintId={id}`. | Remove it from the product page inventory. Sprints should live only inside the project detail page as the Sprints tab. |
| 13. `/projects/new` | Create-project wizard route. It is used before a project exists, accepts `source=scratch/github/upload`, and redirects unauthenticated users to login. | Keep as a separate page unless the product wants project creation to exist only as a modal. It is not a project detail tab because there is no project detail yet. |
| 14-20. `/settings/*` | Settings is currently route-per-section: account, security, privacy, notifications, appearance, integrations, plus `/settings` redirecting to `/settings/account`. | Collapse to one `/settings` page with tabs. Appearance, integrations, notifications, privacy, security, and account should be tabs, not separate pages. |
| 21. `/u/[username]` | Public profile route by username. Example: `/u/rama`. It resolves `profiles.username` and username aliases, then renders a public profile or redirects to the canonical username. | Keep. It is different from `/profile`, which is the signed-in user's own profile space. |
| 24. `/admin/notifications` | Admin-only notification operations dashboard. It queries delivery, retention, and push-subscription metrics and returns 404 for non-admin users. | Keep separate from user settings. It is an internal/admin ops page, not the user's notification preferences tab. |
| 25. `/` | Public landing/home page with signup and login calls to action. | Keep if the app needs a public marketing entry point. Optionally redirect already-authenticated users to `/hub`, but it should not become a settings/project tab. |

Live Supabase and schema evidence for these decisions:

- Sprint data is real and should remain in the database: live Supabase currently has 1 `project_sprints` row and 1 `tasks` row with `sprint_id` set. The schema has `project_sprints`, `tasks.sprint_id`, `status_sprint`, sprint/task indexes, and RLS policies for sprint/task access. Removing the sprint URL page must not remove sprint tables or sprint functionality.
- Username data is real and supports `/u/[username]`: live Supabase currently has 10 profiles with usernames, 47 username aliases, and 13 reserved usernames. The schema has `profiles.username`, `username_aliases`, and `reserved_usernames`; this is exactly why `/u/[username]` exists.
- Notification admin data is real and separate from user settings: live Supabase currently has 26 `user_notifications`, 0 `notification_deliveries`, and 0 `push_subscriptions`. The admin route reads aggregate operations tables; the settings notification tab manages user preferences.
- Storage is not the root cause of any selected extra route. Live storage buckets are unchanged by this routing decision: `avatars`, `chat-attachments`, `extension-recovery-drafts`, `project-files`, `project-updates-media`, and `task-files`.
- No SQL migration is required only to consolidate these routes. The work is primarily Next.js route files, navigation links, page contracts, tests, baselines, and a few OAuth/internal redirect URLs.

### ADD-01: Sprint detail route is a stale compatibility page and should be removed from product routing

Evidence:

- `src/app/(main)/projects/[slug]/sprints/[sprintId]/page.tsx` does not render sprint UI. It only calls ``redirect(`/projects/${slug}?tab=sprints&sprintId=${sprintId}`)``.
- `src/lib/projects/sprint-detail.ts` already builds the canonical sprint URL as `/projects/{slug}?tab=sprints&sprintId={id}`.
- `src/components/projects/tabs/SprintPlanning.tsx` still contains special handling for `pathname?.includes("/sprints/")`, which exists only because the legacy route exists.
- `src/lib/performance/page-contract.ts` still includes `/projects/[slug]/sprints/[sprintId]`, so audits count it as a page even though the UI is the project detail Sprints tab.

Root cause:

The sprint feature was correctly moved into the project detail Sprints tab, but the old URL was left behind as a compatibility route and the sprint tab kept branch logic for both URL models. That makes the page inventory confusing and keeps stale routing code alive.

End-to-end solution:

1. Delete `src/app/(main)/projects/[slug]/sprints/[sprintId]/page.tsx`.
2. Remove `/projects/[slug]/sprints/[sprintId]` from `src/lib/performance/page-contract.ts`, route baselines, route inventory tests, and any docs that list routable product pages.
3. Keep `buildProjectSprintDetailHref()` canonicalized to `/projects/{slug}?tab=sprints&sprintId={id}`.
4. Remove `pathname?.includes("/sprints/")` branches from `SprintPlanning`; all sprint URL state should assume the project detail route.
5. Audit all sprint links and notifications so they point to `/projects/{slug}?tab=sprints&sprintId={id}`.
6. Keep all database objects: `project_sprints`, `tasks.sprint_id`, sprint indexes, `status_sprint`, and sprint/task RLS policies.
7. If backward compatibility for shared old links is required, add a temporary redirect outside the page inventory and schedule its deletion; otherwise allow the old URL to 404 after links are updated.

Acceptance checks:

- `check:page-contract` reports one fewer page.
- `rg '/sprints/|includes\\("/sprints/"\\)' src tests docs` has no active app references except deliberate migration/history docs.
- Opening a sprint from project detail stays on `/projects/{slug}?tab=sprints&sprintId={id}`.
- Project detail Sprints tab still reads and writes existing sprint/task data.

Ponytail read:

`delete:` the redirect page and legacy branch code. Do not add a new sprint router; the project detail tab URL already exists.

### ADD-02: Settings sections are currently separate pages and should become tabs under one `/settings` page

Evidence:

- `src/app/(main)/settings/page.tsx` currently redirects to `/settings/account`.
- Six route files render individual sections: `/settings/account`, `/settings/appearance`, `/settings/integrations`, `/settings/notifications`, `/settings/privacy`, and `/settings/security`.
- `src/components/settings/SettingsLayout.tsx` defines six `href` values pointing to those separate routes.
- `src/lib/performance/page-contract.ts`, `docs/performance/route-baseline.json`, and settings E2E tests all treat those settings sections as separate pages.
- The earlier rendering trace showed `/settings/account` prefetching sibling settings pages, which is an avoidable side effect of route-per-tab navigation.

Root cause:

Settings was implemented as route-per-section with a shared shell. That is a valid Next.js pattern, but it does not match the desired product model. The desired product model is one settings page with in-page tabs.

End-to-end solution:

1. Make `src/app/(main)/settings/page.tsx` the real settings page instead of a redirect.
2. Introduce one active tab parameter, for example `/settings?tab=account`, `/settings?tab=security`, `/settings?tab=privacy`, `/settings?tab=notifications`, `/settings?tab=appearance`, and `/settings?tab=integrations`.
3. Render only the active settings tab. Do not mount all six settings components hidden at once, or this fix would trade route fanout for hidden component work.
4. Replace the six `SettingsLayout` route links with tab links pointing to `/settings?tab=...`; set `prefetch={false}` on tab links unless a deliberate hover/focus warmup is needed.
5. Delete the six child page files when all internal links are migrated. If old shared URLs must survive briefly, replace them with temporary redirects to `/settings?tab=...`, then delete them after the compatibility window.
6. Update internal links:
   - `/settings/security` -> `/settings?tab=security`
   - `/settings/integrations` -> `/settings?tab=integrations`
   - `/settings/notifications` -> `/settings?tab=notifications`
7. Update the Supabase OAuth identity redirect URL currently pointing to `/settings/integrations`; it should return to `/settings?tab=integrations`.
8. Update `src/lib/performance/page-contract.ts` so only `/settings` is a page contract for settings.
9. Update settings tests and route baselines to navigate tabs on `/settings`, not separate pages.
10. Keep the existing settings data model. Account/profile/notification/privacy/security state already lives in `profiles`, `profile_security_states`, auth/session data, push subscriptions, notification preferences, and integration helper APIs; no SQL schema split is needed.

Acceptance checks:

- `check:page-contract` reports six fewer settings pages.
- `/settings` loads Account by default.
- `/settings?tab=security`, `/settings?tab=privacy`, `/settings?tab=notifications`, `/settings?tab=appearance`, and `/settings?tab=integrations` switch tabs without leaving the settings page.
- A production browser trace for `/settings` shows no idle sibling-page RSC prefetches.
- OAuth linking returns to the Integrations tab.
- Each tab's existing save/update behavior still writes to the same backend tables/APIs as before.

Ponytail read:

`shrink:` one page, one active tab, one mounted settings section. Delete the six page surfaces instead of adding another layer over them.

### ADD-03: Routes that are confusing but should remain separate

`/projects/new`:

- Meaning: create a new project. It renders `CreateProjectRouteClient`, accepts an optional `source` query for `scratch`, `github`, or `upload`, and redirects unauthenticated users to `/login`.
- Why it should remain separate: a project detail page requires an existing project slug. During creation there is no project yet, so this is a wizard/creation route, not a project detail tab.
- If product direction changes: convert project creation to a modal launched from `/hub`, then remove `/projects/new` and update Sidebar/MobileNav links. That is optional and not required by this audit.

`/u/[username]`:

- Meaning: public profile by username. `username` is not literal text; it is a dynamic placeholder. A real URL is `/u/rama` or `/u/some-handle`.
- Backend path: it resolves `profiles.username` and `username_aliases`, respects public-profile privacy, redirects old aliases to the canonical username, and renders the public profile.
- Why it should remain separate: `/profile` is the signed-in user's own profile management/view. `/u/[username]` is the public canonical profile URL for any user.

`/admin/notifications`:

- Meaning: admin-only notification operations dashboard. It queries `notification_deliveries`, `user_notifications`, and `push_subscriptions`, and hides behind `isAdminUser()`.
- Why it should remain separate: it is operational monitoring, not the user's notification settings. The user-facing notification preferences belong in `/settings?tab=notifications`.

`/`:

- Meaning: public landing page with marketing copy, signup, and login links.
- Why it should remain separate: it is the public entry point. If the app should feel more app-like for signed-in users, add an authenticated redirect from `/` to `/hub`; do not merge it into settings or project detail.

## Route Rendering Measurements

These are authenticated production browser traces. `commits` means React commit count observed during the measurement window.

| Route / flow | Final route | Commits | Resources | Fetches | App RSC | App API | Supabase REST | JS loaded |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/login` while already authenticated | `/hub` | 31 | 89 | 41 | 31 | 5 | 3 | 589 KB |
| `/hub` | `/hub` | 31 | 89 | 41 | 31 | 5 | 3 | 589 KB |
| `/people?tab=discover` | same | 28 | 57 | 14 | 4 | 5 | 2 | 619 KB |
| `/people?tab=network` | same | 28 | 60 | 17 | 7 | 5 | 2 | 619 KB |
| `/people?tab=requests` | same | 27 | 67 | 24 | 12 | 5 | 2 | 619 KB |
| `/profile` overview | same | 29 | 61 | 17 | 8 | 5 | 2 | 604 KB |
| `/profile?tab=portfolio` | same | 27 | 64 | 20 | 10 | 6 | 2 | 604 KB |
| `/projects/ponytail` dashboard | same | 36 | 65 | 19 | 9 | 5 | 2 | 749 KB |
| `/projects/ponytail?tab=files` | same | 29 | 69 | 19 | 7 | 6 | 3 | 828 KB |
| `/messages` | same | 54 | 58 | 16 | 4 | 5 | 2 | 631 KB |
| `/settings/account` | same | 22 | 64 | 24 | 15 | 5 | 2 | 552 KB |
| `/settings/security` | same | 24 | 68 | 25 | 15 | 6 | 2 | 564 KB |

Additional project analytics tab-click measurement on owned project `e2e-files-workspace-controls`:

- Initial dashboard load: 31 commits, 65 resources.
- Click Analytics tab: +9 commits, +6 resources, +4 fetches.
- Final URL: `/projects/e2e-files-workspace-controls?tab=analytics&analyticsTab=overview`.

Static client entry JS size from `.next/server/app/*page_client-reference-manifest.js`:

| Route | Raw JS | Gzip JS | Chunks |
|---|---:|---:|---:|
| `/projects/[slug]` | 1,514 KB | 409 KB | 19 |
| `/profile` | 1,295 KB | 322 KB | 21 |
| `/u/[username]` | 1,295 KB | 322 KB | 21 |
| `/people` | 1,125 KB | 293 KB | 20 |
| `/projects/new` | 1,057 KB | 299 KB | 16 |
| `/hub` | 1,052 KB | 274 KB | 16 |
| `/messages` | 1,019 KB | 298 KB | 16 |
| `/settings/security` | 666 KB | 195 KB | 11 |
| `/settings/integrations` | 641 KB | 188 KB | 11 |
| `/settings/notifications` | 641 KB | 189 KB | 11 |
| `/settings/privacy` | 639 KB | 187 KB | 11 |
| `/settings/appearance` | 632 KB | 185 KB | 11 |
| `/settings/account` | 631 KB | 185 KB | 11 |

The entry JS alone exceeds declared page-contract payload budgets for at least `/projects/[slug]`, `/profile`, `/u/[username]`, `/people`, `/projects/new`, and `/hub`. Caveat: the current contract checker does not measure this, so this is an audit finding about the enforcement gap and likely payload drift, not a failed existing check.

## Findings and Complete Fix Plans

### P0-01: Hub project cards still auto-prefetch every visible project

Evidence:

- Browser trace for `/hub` and authenticated `/login`->`/hub` showed 31 app RSC fetches and visible project paths being prefetched.
- `src/components/projects/ProjectCard.tsx` comments say prefetch was removed, but both overlay `<Link>` elements omit `prefetch={false}`.
- The component also calls `warmPrefetchRoute(projectHref)` on hover/pointer enter.

Root cause:

Next.js default viewport prefetch remains enabled, so the page does both automatic RSC prefetch and manual warm prefetch.

End-to-end solution:

- Add `prefetch={false}` to both project-card overlay links.
- Keep the existing `useRouteWarmPrefetch` path, but dedupe it per route and cap concurrency.
- Add a regression test or route trace that asserts hub load does not fetch project detail RSC paths before hover/focus.
- Re-run `/hub` browser trace and compare RSC/fetch count.

Ponytail read:

`shrink:` one prop on the existing `Link`s is the smallest correct fix. No new prefetch manager is needed unless trace data still shows duplicate warmups after that.

### P0-02: Settings nav prefetches all sibling settings routes

Evidence:

- `/settings/account` trace showed 15 app RSC requests, including `/settings/integrations`, `/settings/appearance`, `/settings/notifications`, `/settings/privacy`, `/settings/security`, `/settings/account`, `/profile`, `/`, and `/hub`.
- `src/components/settings/SettingsLayout.tsx` maps six `<Link>` nav entries with default prefetch.

Root cause:

Settings uses route-per-tab navigation, but every sibling link uses Next.js default prefetch inside the settings shell.

End-to-end solution:

- Set `prefetch={false}` on settings nav links.
- Optionally add pointer/focus warmup for the next intended route only.
- Add a Playwright trace assertion for `/settings/account`: no sibling settings RSC fetches on idle load.
- Re-run account/security settings traces after the change.

Ponytail read:

`native:` use the existing `Link` prop; no custom navigation layer.

### P0-03: Main authenticated layout mounts global runtime work on every main route

Evidence:

- `src/app/(main)/layout.tsx` wraps main routes in `AuthRouteProviders`, `MainRuntimeProviders`, and `MainLayout`.
- `src/components/providers/MainRuntimeProviders.tsx` always mounts `PresencePublisher`, `RealtimeProvider`, and `PeopleNotificationsProvider`, then lazily enables `ChatProvider`.
- `PeopleNotificationsProvider` immediately performs a `connections` count query for every authenticated main page.
- `RealtimeProvider` opens a user notification/profile/conversation/task channel for every authenticated main page.
- `useNotifications` in the top nav adds a separate notification inbox realtime channel and unread-count query.

Root cause:

Global providers are page-agnostic. Work needed by chat, notifications, presence, and people badges is paid on pages where the user may never interact with those features.

End-to-end solution:

- Keep auth/context global, but split feature runtimes by route class.
- Load chat runtime only on `/messages` or after the user opens chat.
- Load people pending-count query only where the people badge is visible/important, or fold it into a shared notification count.
- Merge notification realtime concerns where possible: one user notification stream should feed both top-nav count and tray state.
- Add a route-class runtime contract: each route declares allowed global realtime channels and immediate REST reads.
- Re-run all measured routes and compare API/RSC/Supabase counts.

Ponytail read:

`delete:` default global work for features the user has not opened. Replace with existing lazy route/interaction activation.

### P0-04: Presence heartbeat can trigger profile refresh feedback

Evidence:

- `MainRuntimeProviders` sends `POST /api/v1/presence/heartbeat` immediately and every 4 minutes while visible.
- Server endpoint updates `profiles.last_active_at` after Redis debounce.
- `RealtimeProvider` listens for profile events and calls `refreshProfile()` for any profile event.
- `pg_stat_statements` shows heartbeat update query: 9,812 calls, 235,251.68 ms total, 23.98 ms mean.

Root cause:

Presence state is stored on `profiles`, and profile realtime updates are treated as meaningful profile changes. A heartbeat can therefore produce a profile event, then a browser profile refresh.

End-to-end solution:

- Avoid emitting profile-refresh work for `last_active_at`-only changes.
- Prefer a separate presence table/channel, or remove `profiles` from the global notification/profile listener if it is only used for profile refresh.
- Update heartbeat SQL to update only when the existing value is older than the debounce threshold.
- Add a regression trace: heartbeat should not cause `/profile` or auth profile reloads.

Ponytail read:

`shrink:` do not build a new presence subsystem first. The smallest strong fix is to ignore `last_active_at`-only realtime payloads and add a timestamp guard to the update.

### P0-05: Project detail keeps visited tabs mounted and hidden

Evidence:

- `src/components/projects/dashboard/ProjectDashboardClient.tsx` stores `visitedTabs`.
- Each visited tab remains rendered with `hidden={activeTab !== ...}`.
- This applies to Dashboard, Docs, Updates, Sprints, Tasks, Analytics, Files, and Settings.
- Hidden tabs can keep effects, React Query observers, realtime subscriptions, editors, and timers alive.

Root cause:

State preservation is implemented by keeping full tab trees mounted.

End-to-end solution:

- Unmount inactive heavy tabs by default.
- Preserve user-visible state in URL, React Query cache, or a small local store instead of hidden components.
- For tabs that truly must stay alive, add explicit `enabled: activeTab === ...` guards to queries/effects/realtime hooks.
- Add a project detail tab-switch profiler test: after switching away from Files/Analytics/Tasks, no inactive-tab network or realtime work should continue.

Ponytail read:

`delete:` hidden mounted tab trees. Query cache already preserves most loaded data.

### P0-06: Analytics tab fetches inactive datasets and duplicates member fetches

Evidence:

- `src/components/projects/tabs/AnalyticsTab.tsx` always calls `useProjectAnalyticsOverview(projectId, context)` and `useProjectAnalyticsMembers(projectId)`.
- When the active analytics subtab is Members, `AnalyticsMembers` also calls `useProjectAnalyticsMembers(projectId, context)`.
- Parent members query omits the context while child query includes context, so they can become separate React Query keys.
- Analytics tab-click measured +9 commits and +4 fetches.

Root cause:

The parent tab preloads both overview and members unconditionally, and the members child owns its own query key.

End-to-end solution:

- Add `enabled` options to analytics hooks and enable only the active subtab data.
- Normalize the analytics context so parent and child share the same key when they need the same data.
- Share one member dataset between tab chrome and member detail, or have child accept parent data.
- Move expensive whole-dataset analytics into aggregate SQL if overview/timeline do not require raw rows.
- Add a tab-click trace for overview -> members -> timeline and assert one dataset fetch per active view.

Ponytail read:

`shrink:` one normalized query per visible analytics pane. Do not add a new analytics cache layer until duplicate keys are gone.

### P0-07: Hydration progress banner polls `projects.import_source` every 5 seconds

Evidence:

- Latest Supabase API logs show repeated `GET /rest/v1/projects?select=import_source&id=eq...` every about 5 seconds from Safari.
- `src/components/projects/HydrationProgressBanner.tsx` performs an initial fetch, subscribes to realtime, and starts `setInterval(fetchProgress, 5000)` unconditionally for the mounted banner component.
- The banner returns `null` unless hydration status is `in_progress`, but the polling still runs after no in-progress hydration is found.

Root cause:

Fallback polling is unconditional while the component is mounted, even when there is no active hydration to display.

End-to-end solution:

- After the initial fetch, only keep polling while hydration status is `in_progress`.
- If realtime is subscribed successfully and no active hydration exists, stop the interval.
- If fallback polling is needed, add a maximum duration/backoff and visibility guard.
- Add a browser/Supabase log assertion: no `projects.import_source` poll on steady-state project pages.

Ponytail read:

`delete:` permanent fallback polling. Realtime plus short, bounded fallback during active hydration is enough.

### P0-08: Missing `get_mutual_connections` RPC is still called

Evidence:

- Latest Supabase API logs show `POST /rest/v1/rpc/get_mutual_connections` returning 404.
- `src/lib/data/profile.ts` calls `supabase.rpc('get_mutual_connections')` after Redis fallback misses.
- `src/app/actions/profile.ts` calls the same RPC inside `getProfileViewerOverlayAction`.
- Both paths swallow failure and return `0`, so user-facing mutual counts degrade silently while logs still pay for failed RPC calls.

Root cause:

Code expects a database function that is absent in the live Supabase catalog.

End-to-end solution:

- Decide one canonical mutual-count source.
- If Redis social graph is canonical, remove the missing RPC fallback and use existing SQL/privacy helpers only where Redis is unavailable.
- If SQL is canonical, add the function in a migration, add RLS-safe tests, and include it in schema drift checks.
- Add a contract check that every `supabase.rpc('...')` in code exists in the live schema/migrations.
- Re-run Supabase API logs after navigation to profile/public profile and confirm no 404 RPC calls.

Ponytail read:

`delete:` the missing RPC fallback is currently dead weight. Add SQL only if Redis cannot be made authoritative.

### P0-09: Notification runtime has two overlapping user notification channels

Evidence:

- `RealtimeProvider` subscribes to `subscribeUserNotifications`.
- `useNotifications` separately subscribes to `subscribeNotificationInbox`.
- Top nav uses notification hooks on all main pages.
- Supabase publication includes `user_notifications`, while Realtime historical statements show very high `list_changes` volume.

Root cause:

The notification count/tray path and the general realtime provider both listen to notification-related state.

End-to-end solution:

- Choose one browser-side user notification stream.
- Feed unread count, tray cache patches, toast decisions, and message attention from that stream.
- Keep tray page fetching disabled until open, but do not keep a second realtime channel for the count.
- Add runtime instrumentation for active channels per route.

Ponytail read:

`delete:` duplicate channel. One notification stream should fan out locally.

### P1-10: Browser-auth and JWKS calls repeat during local authenticated traces

Evidence:

- Auth logs show repeated `/user`, `/token`, and `/.well-known/jwks.json` calls during local tests.
- Browser route traces show app API/auth/session calls across main routes.
- API logs show repeated JWKS fetches from Node.

Root cause:

The app and Supabase auth helpers likely validate sessions in multiple layers during route loads: middleware, server actions/RSC, and client providers.

End-to-end solution:

- Audit session retrieval path from middleware -> layout -> server page -> client auth provider.
- Keep one server-side viewer context per RSC request using existing React cache wrappers.
- Cache JWKS validation for the process/runtime if not already done by the library.
- Add request-scoped tracing for `auth.getUser()` / JWKS calls.

Ponytail read:

`shrink:` consolidate existing viewer-context calls before adding another auth cache abstraction.

### P1-11: TopNav profile and logo links likely prefetch global routes

Evidence:

- `/settings/account` trace fetched `/profile`, `/`, and `/hub` RSC paths.
- `src/components/layout/header/TopNav.tsx` profile link to `ROUTES.PROFILE` lacks `prefetch={false}`.
- Logo link also lacks `prefetch={false}`.
- `NavLink` already sets `prefetch={false}`, so the codebase pattern exists.

Root cause:

Some top-nav links use the existing no-prefetch pattern; profile/logo do not.

End-to-end solution:

- Add `prefetch={false}` to profile and logo links.
- Use the existing hover/focus warm path only if needed.
- Add route trace assertions for `/settings/*`, `/people`, and `/messages` that no `/profile`/`/` prefetch occurs on idle load.

Ponytail read:

`shrink:` reuse `NavLink` behavior. No new component needed.

### P1-12: Payload budgets are documented but not enforced against actual JS

Evidence:

- `src/lib/performance/page-contract.ts` defines page budgets.
- `check:build-rendering-contract` passed but only validates route classification.
- Manifest measurement shows six routes exceeding declared gzip budgets by entry JS alone.

Root cause:

The budget contract does not measure bundle output.

End-to-end solution:

- Add a manifest-based budget check for raw and gzip client JS per route.
- Keep route-specific budgets in `page-contract.ts`.
- Fail CI when a route exceeds budget unless an explicit reviewed budget change is made.
- Split heavy route graphs after the check is real; do not raise budgets first.

Ponytail read:

`native:` use the build manifest already emitted by Next. No bundle analyzer dependency is required for the first guard.

### P1-13: Baseline performance reports are stale/blocked

Evidence:

- `docs/performance/route-baseline.json` is from 2026-03-12, includes only 19 routes, includes `/settings/languages` which is not a current page, and protected routes land on `/login`.
- `reports/stability/headroom/latest.json` says BLOCKED because external capacity audit is missing/not approved and production rollout is not approved.
- `reports/stability/capacity-audit/latest.json` says the capacity audit file is missing.

Root cause:

Performance evidence was not regenerated after routing/settings/project-detail changes.

End-to-end solution:

- Regenerate authenticated baselines for all 25 pages and important tab flows.
- Include page/tab traces, RSC counts, API counts, Supabase counts, JS sizes, and React commits.
- Replace or archive stale baselines so audits do not trust obsolete numbers.
- Keep capacity signoff separate from implementation signoff.

Ponytail read:

`delete:` stale baseline as decision input. Replace with one current trace set.

### P1-14: Storage policy drift checker is stale after hardening migration

Evidence:

- `scripts/check-db-catalog-drift.ts` expects `project_updates_media_public_read`, `project_updates_media_write`, and `project_updates_media_delete`.
- `drizzle/0122_ponytail_database_hardening.sql` drops those and creates `project_updates_media_insert` and `project_updates_media_delete`.
- Live storage policies match the hardened shape: insert/delete policies for `project-updates-media`; direct read is covered by public bucket behavior and app route access checks.

Root cause:

The catalog drift script was not updated after the hardening migration renamed/reduced policies.

End-to-end solution:

- Update the drift contract to expect current hardened policy names.
- Add explicit bucket public/private assertions so public read does not depend on a storage object SELECT policy name.
- Keep migration 0085 history but assert final live state from latest migrations.
- Re-run `check:db:catalog-drift`.

Ponytail read:

`shrink:` update the checker, not the database. The live DB is not missing those old policies.

### P1-15: Realtime publication includes many tables; channel use should be capped by route

Evidence:

- `supabase_realtime` publication includes `comment_mentions`, `connections`, `conversation_participants`, `file_versions`, message tables, `profiles`, `project_node_locks`, project update tables, `projects`, task tables, and `user_notifications`.
- `pg_stat_statements` shows historical Realtime `list_changes` variants with millions of calls since stats reset in 2025-12-08.
- Realtime logs show tenant start/stop cycles when users connect/disconnect and repeated partition creation/janitor work for `realtime.messages`.

Root cause:

Realtime is broadly available and multiple global/feature providers can subscribe without a per-route cap.

End-to-end solution:

- Create a route-level channel inventory and enforce max channels per route class.
- Remove tables from publication if no current browser subscription uses them.
- Keep replica identity minimal unless old-row values are required.
- Add runtime logging of active channel topic/table/filter per browser session in development.

Ponytail read:

`delete:` published tables and route subscriptions not used by a live feature.

### P1-16: `project-files` storage is large and MIME-unrestricted

Evidence:

- Storage buckets: `project-files` is private with 8,877 objects and about 309,552,980 logical bytes.
- Bucket MIME allowlist is null/unrestricted.
- Live object/reference reconciliation query gave inconsistent totals for `project-files` and must be independently rechecked before deletion.

Root cause:

Project file storage is the dominant storage bucket and currently accepts unrestricted MIME types.

End-to-end solution:

- Add a MIME allowlist aligned with editor/import capabilities.
- Add an independent storage reference reconciliation job before any cleanup.
- Delete only objects confirmed orphaned by two independent sources and outside a grace period.
- Add lifecycle/reporting for old versions and upload intents.

Ponytail read:

`native:` use Supabase bucket file-size/MIME controls first. Do not build a custom file scanner before bucket limits are correct.

### P1-17: Public `project-updates-media` bucket needs an explicit product decision

Evidence:

- `project-updates-media` is public with 6 objects and about 1,417,914 bytes.
- Live policies cover insert/delete, not read; public bucket retrieval bypasses storage read policy by design.
- App route creates signed URLs after access checks, but direct public object URLs are still possible if object paths are known.

Root cause:

The bucket is public while the app also has access-checked route behavior.

End-to-end solution:

- If update media is intended to be public, document that object keys are public and keep opaque names.
- If media should follow project visibility strictly, make the bucket private and serve reads only through signed URLs after access checks.
- Update catalog drift checks to assert the chosen model.

Ponytail read:

`delete:` one of the two access models. Public bucket plus signed route is only okay if public direct-read is intentional.

### P1-18: Supabase advisor reports many zero-scan indexes, but this is not a bulk-drop instruction

Evidence:

- Performance advisor reports only INFO-level `unused_index` items.
- Direct catalog query found 260 zero-scan public indexes; 233 are nonconstraint indexes, about 7,077,888 bytes for nonconstraint candidates.
- Exact duplicate index group found only on platform-managed `auth.custom_oauth_providers_identifier_idx` and `auth.custom_oauth_providers_identifier_key`.
- No invalid indexes found.

Root cause:

The schema has accumulated feature/search/partition/support indexes that have not been used since stats reset or under the observed workload.

End-to-end solution:

- Do not drop primary, unique, FK-supporting, or platform-managed indexes.
- For nonconstraint zero-scan candidates, require two traffic windows, query-plan checks, and feature-owner review.
- Drop in small migrations grouped by feature/table, with rollback scripts.
- Re-run advisors and key query EXPLAINs after each batch.

Ponytail read:

`delete:` unused indexes only after evidence. The lazy fix is not a giant dangerous drop; it is a measured small deletion.

### P1-19: `pg_stat_user_functions` has no data

Evidence:

- 30 functions found across public/storage/auth.
- `pg_stat_user_functions` had no useful function execution stats because tracking is not enabled.

Root cause:

Function-level observability is missing, so trigger/function cost has to be inferred from statements/logs.

End-to-end solution:

- Enable function tracking in a controlled environment or add targeted app-level timing around critical DB functions/triggers.
- Track `handle_message_insert_consistency` cost specifically because it updates conversation and participant rows per message insert.
- Do not turn on noisy observability in production without a rollback plan.

Ponytail read:

`shrink:` instrument only the hot functions first.

### P1-20: SECURITY DEFINER functions are limited, but should stay audited

Evidence:

- Only two `SECURITY DEFINER` functions were found:
  - `public.handle_message_insert_consistency()` trigger function, owner `postgres`, grants only `postgres` and `service_role`, `search_path` set to empty string.
  - `public.rls_auto_enable()` event trigger function, owner `postgres`, grants only `postgres` and `service_role`, `search_path` set to `pg_catalog`.

Root cause:

Privileged functions are necessary for trigger/event-trigger behavior, but they are sensitive.

End-to-end solution:

- Keep grants restricted to `postgres` and `service_role`.
- Add a schema contract check for `SECURITY DEFINER` functions: owner, grants, search_path, volatility, and expected names.
- Alert on any new SECURITY DEFINER function.

Ponytail read:

Lean already. Ship the contract check, not a wrapper layer.

### P1-21: Security advisor warning for leaked password protection remains

Evidence:

- Security advisor reports `auth_leaked_password_protection` WARN.
- Existing app fallback password strength logic exists, but native Supabase leaked password protection is disabled.

Root cause:

Native leaked-password protection is not enabled in Supabase Auth.

End-to-end solution:

- If the current Supabase plan supports it, enable native leaked password protection.
- If plan-gated, document the limitation and keep app-level fallback.
- Add this to release/security checklist.

Ponytail read:

`native:` prefer Supabase Auth's built-in protection over custom password breach checks.

### P1-22: RLS no-policy advisor items are mostly intentional fail-closed tables

Evidence:

- Security advisor reports INFO `rls_enabled_no_policy` on public server-only/import/job/partition tables.
- Catalog query also saw RLS-enabled no-policy storage internals.
- No duplicate app policies found.
- 191 policies exist across public/storage.

Root cause:

Tables with RLS enabled and no policies are denied to anon/auth users by default. Some are intentionally server-only or partition children.

End-to-end solution:

- Keep intentional no-policy tables in an allowlist with owner/justification.
- Do not add permissive policies to suppress INFO lint.
- Re-run `check:rls-contract` after changes.

Ponytail read:

`delete:` no-op policies. Deny-all RLS is simpler and safer when intentional.

### P1-23: Task detail tabs also preserve loaded tabs

Evidence:

- `src/hooks/useTaskPanelResource.ts` maintains loaded tab state.
- Workspace task detail and project task panel share 5 tabs and keep loaded tab content around.

Root cause:

Task panels use loaded-tab preservation similar to project detail.

End-to-end solution:

- Keep the active tab mounted.
- Preserve draft/comment state in a small store if needed.
- Disable inactive tab effects/queries/realtime explicitly.
- Add profiler trace for task panel tab switching.

Ponytail read:

`delete:` hidden inactive work unless it protects unsaved edits.

### P1-24: Message page has the highest observed commit count

Evidence:

- `/messages` measured 54 commits in the trace window, higher than other measured routes.
- Static dependency graph: 193 deps, 61 client modules, 84 effects, 26 realtime references, 29 timers.

Root cause:

Messages combines realtime, chat UI state, thread/list data, attention state, and global main providers.

End-to-end solution:

- Profile `/messages` with React Profiler and channel instrumentation.
- Separate initial shell from active conversation realtime.
- Ensure only the active tab from `chats/applications/projects` is mounted.
- Defer popup/chat provider duplication on the full messages page.

Ponytail read:

`shrink:` first remove global duplicate chat/notification work from the messages page before splitting UI components.

### P1-25: Settings/security imports more client graph than appearance

Evidence:

- Settings routes share shell JS around 631-666 KB raw; security is highest at 666 KB raw / 195 KB gzip.
- Static graph for settings/security has 123 deps; other settings pages are lower.

Root cause:

Security settings pulls MFA, session list, password management, and step-up dialog dependencies into the route bundle.

End-to-end solution:

- Lazy-load MFA setup, sessions list details, and step-up dialogs behind interaction/section visibility.
- Keep summary/security status in initial shell.
- Add route-level bundle budgets for each settings route.

Ponytail read:

`delete:` initial code for controls the user has not opened.

### P2-26: Live logs show task comments/subtasks duplicate HEAD/GET pairs

Evidence:

- Recent API logs show repeated `HEAD` and `GET` calls for `task_comments` and `task_subtasks` for the same task ID within the same timestamp cluster.

Root cause:

Likely count queries and data queries run separately for task tabs, possibly duplicated by hidden loaded tabs or count badges.

End-to-end solution:

- Trace task panel resource loading and count badge logic.
- Combine count and first page where possible, or remove count HEAD calls until tab opens.
- Add test trace for opening a task panel and switching tabs.

Ponytail read:

`shrink:` one query per visible tab; avoid count queries when the data query already proves existence.

### P2-27: `reactStrictMode` makes local dev look worse than production

Evidence:

- `next.config.ts` has `reactStrictMode: true`.
- Browser production traces were used for the measured table, but developer screenshots/dev observations may show double effects from Strict Mode.

Root cause:

React Strict Mode intentionally double-invokes some render/effect paths in development.

End-to-end solution:

- Keep Strict Mode enabled.
- Use production traces for performance decisions.
- Label dev-only double render separately from production duplicate work.

Ponytail read:

Lean already. Do not disable Strict Mode to hide symptoms.

### P2-28: Migration registry mismatch between Supabase and app migration journal

Evidence:

- Supabase `list_migrations` returned an empty list.
- App tracks 123 Drizzle migrations plus app migration journal.
- Postgres logs include `relation "supabase_migrations.schema_migrations" does not exist`.

Root cause:

The project uses Drizzle/app migration tracking rather than Supabase migration registry.

End-to-end solution:

- Document Drizzle as authoritative migration source.
- Keep Supabase migration-registry checks from being interpreted as missing schema.
- If Supabase migrations are desired later, migrate carefully and avoid dual-authority drift.

Ponytail read:

`delete:` misleading Supabase migration-registry expectation unless the team chooses that workflow.

### P2-29: Storage reference reconciliation query was internally inconsistent

Evidence:

- Earlier reference query reported for `project_files`: 8,877 objects, 3,958 referenced, 6,118 orphan objects, 1,199 missing objects.
- The counts are internally inconsistent because referenced + orphan exceeds objects.

Root cause:

The reconciliation query likely counted multiple DB references per object or joined at the wrong granularity.

End-to-end solution:

- Rebuild reconciliation around distinct storage object keys.
- Compare storage -> DB and DB -> storage as two separate reports.
- Require two independent confirmations before deleting or backfilling storage objects.

Ponytail read:

`shrink:` fix the query before building cleanup automation.

### P2-30: App has no database cron/net background workers

Evidence:

- `net` schema not present.
- `cron` schema not present.
- Active background evidence is Supabase platform work: realtime replication slots, realtime janitor/partition creation, and normal Postgres checkpoints.

Root cause:

No app-owned database scheduler was found.

End-to-end solution:

- Do not chase phantom DB cron work.
- Focus background-work optimization in frontend providers, realtime subscriptions, app workers, Inngest functions, and storage/file import paths.

Ponytail read:

`delete:` investigation path for non-existent cron/net workers.

## Supabase Catalog Snapshot

Project:

- ID: `iutauehhgdymtpzrnzcy`
- Region: `ap-southeast-1`
- Status: active/healthy
- Postgres: 17.6.1.063
- Database size: about 113,855,635 bytes

Schemas:

- `public`: 100 ordinary tables, 1 partitioned table, 563 ordinary indexes, 7 partitioned indexes, 1 sequence, 2 views.
- `auth`: 23 tables, 87 indexes, 1 sequence.
- `storage`: 8 tables, 17 indexes.
- `realtime`: 9 ordinary tables, 1 partitioned parent, 18 ordinary indexes, 2 partitioned indexes, 3 sequences.
- `app_private`: 1 table, 1 index.
- `drizzle`: 1 table, 1 index, 1 sequence.
- `vault`: 1 table, 1 view, 2 indexes.
- `extensions`: 2 views.

Largest live tables:

| Table | Rows | Total size | Heap | Indexes | Notes |
|---|---:|---:|---:|---:|---|
| `public.project_nodes` | 30,547 | 46,825,472 bytes | 9,584,640 | 37,199,872 | Main storage/index weight |
| `storage.objects` | 8,910 | 18,055,168 bytes | 7,020,544 | 10,993,664 | Storage metadata |
| `public.file_versions` | 3,932 | 5,439,488 bytes | 2,981,888 | 2,416,640 | File history |
| `public.profile_audit_events` | 8,346 | 4,202,496 bytes | not material to findings | not material to findings | Audit log |

Rows of note:

- `project_nodes`: 30,547
- `storage.objects`: 8,910
- `file_versions`: 3,932
- `profile_audit_events`: 8,346
- `onboarding_events`: 618
- `skills`: 1,128
- `skill_aliases`: 1,244
- `skill_icon_assets`: 745
- `messages`: 163
- `message_delivery_receipts`: 161
- `message_read_receipts`: 161
- `profiles`: 16
- `projects`: 15

Functions:

- 30 functions across public/storage/auth.
- 2 `SECURITY DEFINER` functions:
  - `public.handle_message_insert_consistency()`
  - `public.rls_auto_enable()`
- No duplicate function body hashes found.

Triggers:

- 31 non-internal triggers across public/storage/auth.
- No duplicate trigger groups found.

Policies:

- 191 policies across public/storage.
- No exact duplicate policy groups found.

Foreign keys:

- 228 foreign keys.
- No missing covering FK indexes found.

Extensions installed:

- `pg_stat_statements` 1.11
- `pg_trgm` 1.6
- `pgcrypto` 1.3
- `plpgsql` 1.0
- `supabase_vault` 0.3.1

No materialized views were found.

## Roles and Enum Types

Roles observed:

- `anon`
- `authenticated`
- `authenticator`
- `dashboard_user`
- `postgres`
- `service_role`
- `supabase_admin`
- `supabase_auth_admin`
- `supabase_etl_admin`
- `supabase_privileged_role`
- `supabase_read_only_user`
- `supabase_realtime_admin`
- `supabase_replication_admin`
- `supabase_storage_admin`

Expected platform roles with bypass/privileged capabilities include `postgres`, `service_role`, `supabase_admin`, `supabase_etl_admin`, and `supabase_read_only_user`. The app must never expose service/admin keys client-side.

Enum types observed:

- `auth.aal_level`: `aal1`, `aal2`, `aal3`
- `auth.code_challenge_method`: `s256`, `plain`
- `auth.factor_status`: `unverified`, `verified`
- `auth.factor_type`: `totp`, `webauthn`, `phone`
- `auth.oauth_authorization_status`: `pending`, `approved`, `denied`, `expired`
- `auth.oauth_client_type`: `public`, `confidential`
- `auth.oauth_registration_type`: `dynamic`, `manual`
- `auth.oauth_response_type`: `code`
- `auth.one_time_token_type`: `confirmation_token`, `reauthentication_token`, `recovery_token`, `email_change_token_new`, `email_change_token_current`, `phone_change_token`
- `public.status_connection`: `pending`, `accepted`, `rejected`, `cancelled`, `disconnected`, `blocked`
- `public.status_file`: `pending`, `finalized`, `expired`, `failed`
- `public.status_job`: `processing`, `completed`, `failed`
- `public.status_notification`: `delivered`, `failed`, `dropped`
- `public.status_project`: `draft`, `active`, `completed`, `archived`
- `public.status_readme_asset`: `draft`, `published`, `orphaned`
- `public.status_report`: `pending`, `reviewed`, `actioned`, `dismissed`
- `public.status_role_app`: `pending`, `accepted`, `rejected`, `withdrawn`, `proposed`
- `public.status_sprint`: `planning`, `active`, `completed`
- `public.status_task`: `todo`, `in_progress`, `done`, `blocked`
- `realtime.action`
- `realtime.equality_op`
- `storage.buckettype`

## Storage Snapshot

Buckets:

| Bucket | Public | Objects | Logical bytes | Size limit | MIME allowlist |
|---|---:|---:|---:|---:|---|
| `avatars` | yes | 16 | 4,778,878 | 10 MB | jpeg, png, webp |
| `chat-attachments` | no | 10 | 16,003,919 | 50 MB | image/video/pdf/doc/text |
| `extension-recovery-drafts` | no | 0 | 0 | 10 MB | text/json/octet |
| `project-files` | no | 8,877 | 309,552,980 | 10 MB | unrestricted |
| `project-updates-media` | yes | 6 | 1,417,914 | 100 MB | jpeg, png, webp, gif |
| `task-files` | no | 1 | 197,171 | 10 MB | unrestricted |

Duplicate storage object keys: none found.

Policy shape:

- `avatars`: owner insert/update/delete.
- `chat-attachments`: owner insert/delete; no direct SELECT policy, private bucket expected to use signed/admin routes.
- `project-files`: insert/select/update/delete with access checks for public project/member/owner.
- `project-updates-media`: insert/delete; public bucket handles direct public read.
- `task-files`: select/insert/delete.

## Realtime Snapshot

Publication `supabase_realtime` includes:

- `public.comment_mentions`
- `public.connections`
- `public.conversation_participants`
- `public.file_versions`
- `public.message_attachments`
- `public.message_delivery_receipts`
- `public.message_edit_logs`
- `public.message_hidden_for_users`
- `public.message_reactions`
- `public.message_read_receipts`
- `public.message_work_links`
- `public.message_workflow_items`
- `public.messages`
- `public.profiles`
- `public.project_node_locks`
- `public.project_update_comments`
- `public.project_updates`
- `public.projects`
- `public.task_comment_likes`
- `public.task_comments`
- `public.task_node_links`
- `public.task_subtasks`
- `public.tasks`
- `public.user_notifications`

Publication `supabase_realtime_messages_publication` includes `realtime.messages`.

Replication slots:

- `supabase_realtime_messages_replication_slot_2_112_6_5042a0b`, pgoutput, active.
- `supabase_realtime_replication_slot_2_112_6_5042a0b`, wal2json.
- Retained WAL was small at the time of audit, about 174 kB.

## Recent Logs Summary

API logs:

- Repeated `GET /rest/v1/projects?select=import_source&id=...` every about 5 seconds, matching `HydrationProgressBanner` polling.
- One live `POST /rest/v1/rpc/get_mutual_connections` 404.
- Repeated task `HEAD` and `GET` calls for `task_comments` and `task_subtasks`.
- Realtime websocket 101 connections.
- Repeated profile and project follow reads during local browser testing.

Postgres logs:

- Normal connections/checkpoints.
- One `relation "supabase_migrations.schema_migrations" does not exist`, consistent with Drizzle/app migration tracking rather than Supabase migration registry.

Realtime logs:

- Tenant start/stop cycles based on connected users.
- Replication slot creation/validation.
- Realtime messages janitor and partition creation.

Storage logs:

- Normal reads for project files, chat attachments, and public avatars.
- Tenant pool lookups.

Auth logs:

- Repeated `/user`, `/token`, and JWKS requests during local authenticated testing.

Edge function logs:

- Empty result in the last 24h query.

## pg_stat_statements Hot Signals

Stats reset: 2025-12-08. These are historical cumulative signals, not current-production-only measurements.

Top relevant app/platform statements:

- Realtime `list_changes` variants:
  - 18,566,792 calls, 89,757,462 ms total, 4.834 ms mean.
  - 1,937,657 calls, 13,701,093 ms total, 7.07 ms mean.
  - 1,621,289 calls, 13,283,970 ms total, 8.19 ms mean.
- Realtime subscription insert: 481,113 calls, 1,510,055 ms total, 3.14 ms mean.
- Presence heartbeat profile update: 9,812 calls, 235,251.68 ms total, 23.98 ms mean.
- Project node file listing query: 17 calls, about 320 ms mean.
- Full tree project node query: 3 calls, about 250.6 ms mean.
- Limited full-column project nodes query: 113 calls, about 193.9 ms mean.
- `delete from project_nodes...`: 261 calls, about 271.5 ms mean, traced to test cleanup script usage.
- `ANALYZE project_nodes`: 120 calls, about 255.8 ms mean, likely migration/admin activity.

## Security Advisor Snapshot

Security advisor findings:

- 24 public `rls_enabled_no_policy` INFO items, mostly server-only tables or partition children.
- 1 `auth_leaked_password_protection` WARN.

RLS no-policy public tables include:

- `app_migration_journal`
- `extension_device_session_events`
- `extension_device_sessions`
- `extension_recovery_sessions`
- `import_job_files`
- `import_jobs`
- `job_heartbeats`
- `project_git_deltas`
- `project_node_conflicts`
- `project_node_events_2026_01`
- `project_node_events_2026_02`
- `project_node_events_2026_03`
- `project_node_events_2026_04`
- `project_node_events_2026_05`
- `project_node_events_2026_06`
- `project_node_events_2026_07`
- `project_node_events_2026_08`
- `project_node_events_2026_09`
- `project_node_events_2026_10`
- `project_node_events_2026_11`
- `project_node_events_2026_12`
- `project_node_events_default`
- `reserved_usernames`
- `task_pushes`

Do not add broad policies just to silence the advisor. If these are intentional server-only/partition tables, preserve deny-all behavior and document the allowlist.

## Zero-Scan Index Group Appendix

Direct catalog query found 260 public indexes with `idx_scan = 0`. Of these, 233 are nonconstraint indexes with about 7,077,888 bytes total. The grouped list below includes every affected table from the grouped export and the nonconstraint/nonunique candidate names. This is a candidate list only; zero-scan indexes can still be required for constraints, future features, or rare query paths.

| Table | Zero-scan indexes | Nonconstraint nonunique candidates | Total size | Candidate names |
|---|---:|---:|---:|---|
| `project_nodes` | 4 | 4 | 1880 kB | `project_nodes_sync_git_idx`, `project_nodes_deleted_at_partial_idx`, `project_nodes_canonical_node_idx`, `project_nodes_task_idx` |
| `projects` | 9 | 9 | 560 kB | `projects_description_search_idx`, `projects_title_search_idx`, `projects_category_status_idx`, `projects_created_at_status_idx`, `projects_feed_newest_idx`, `projects_public_feed_most_followed_active_idx`, `projects_public_feed_most_viewed_active_idx`, `projects_public_feed_newest_active_idx`, `projects_status_visibility_idx` |
| `skill_aliases` | 1 | 1 | 512 kB | `skill_aliases_search_idx` |
| `messages` | 7 | 7 | 360 kB | `messages_content_trgm_idx`, `messages_content_search_idx`, `messages_structured_summary_trgm_idx`, `messages_structured_title_trgm_idx`, `messages_deleted_at_partial_idx`, `messages_sender_idx`, `messages_structured_kind_idx` |
| `profiles` | 14 | 14 | 360 kB | `profiles_username_search_idx`, `profiles_full_name_search_idx`, `profiles_skills_idx`, `profiles_custom_roles_gin_idx`, `profiles_interests_idx`, `profiles_connections_count_idx`, `profiles_created_at_idx`, `profiles_last_active_at_idx`, `profiles_onboarding_status_idx`, `profiles_projects_count_idx`, `profiles_workspace_due_today_count_idx`, `profiles_workspace_in_progress_count_idx`, `profiles_workspace_inbox_count_idx`, `profiles_workspace_overdue_count_idx` |
| `skills` | 3 | 3 | 296 kB | `skills_search_document_idx`, `skills_tier_status_name_idx`, `skills_category_kind_status_idx` |
| `file_versions` | 2 | 2 | 192 kB | `file_versions_content_hash_idx`, `file_versions_uploaded_by_idx` |
| `connections` | 10 | 9 | 160 kB | `connections_addressee_idx`, `connections_addressee_stats_idx`, `connections_blocked_by_idx`, `connections_pending_idx`, `connections_requester_idx`, `connections_requester_stats_idx`, `connections_status_addressee_idx`, `connections_status_requester_idx`, `idx_connections_status` |
| `role_applications` | 10 | 9 | 152 kB | `idx_role_applications_applicant_id`, `idx_role_applications_decision_by`, `role_applications_accepted_member_idx`, `role_applications_applicant_idx`, `role_applications_cooldown_idx`, `role_applications_creator_pending_idx`, `role_applications_project_updated_idx`, `role_applications_proposed_role_idx`, `role_applications_applying_project_idx` |
| `project_file_index` | 1 | 1 | 128 kB | `project_file_index_content_search_idx` |
| `tasks` | 7 | 7 | 120 kB | `tasks_title_search_idx`, `tasks_assignee_status_due_idx`, `tasks_deleted_at_partial_idx`, `tasks_project_sprint_idx`, `tasks_project_status_idx`, `tasks_project_updated_idx`, `tasks_status_idx` |
| `project_update_comments` | 6 | 6 | 96 kB | `project_update_comments_active_parent_idx`, `project_update_comments_deleted_by_idx`, `project_update_comments_parent_idx`, `project_update_comments_target_user_idx`, `project_update_comments_update_active_idx`, `project_update_comments_user_created_idx` |
| `user_notifications` | 6 | 6 | 96 kB | `user_notifications_actor_user_id_idx`, `user_notifications_dismissed_age_idx`, `user_notifications_read_age_idx`, `user_notifications_user_dismissed_idx`, `user_notifications_user_read_idx`, `user_notifications_user_snoozed_idx` |
| `message_work_links` | 5 | 4 | 80 kB | `message_work_links_assignee_status_idx`, `message_work_links_created_by_idx`, `message_work_links_owner_private_idx`, `message_work_links_target_idx` |
| `message_workflow_items` | 5 | 4 | 80 kB | `message_workflow_items_assignee_idx`, `message_workflow_items_conversation_idx`, `message_workflow_items_creator_scope_idx`, `message_workflow_items_task_idx` |
| `project_node_locks` | 5 | 5 | 80 kB | `idx_project_node_locks_locked_by`, `idx_project_node_locks_project_id`, `project_node_locks_cleanup_idx`, `project_node_locks_device_session_idx`, `project_node_locks_project_node_expires_idx` |
| `project_updates` | 5 | 5 | 80 kB | `project_updates_author_created_idx`, `project_updates_covering_feed_idx`, `project_updates_deleted_at_idx`, `project_updates_deleted_by_idx`, `project_updates_public_feed_idx` |
| `extension_recovery_drafts` | 4 | 3 | 64 kB | `extension_recovery_drafts_node_idx`, `extension_recovery_drafts_owner_updated_idx`, `extension_recovery_drafts_project_path_idx` |
| `profile_contribution_skills` | 4 | 2 | 64 kB | `profile_contribution_skills_skill_idx`, `profile_contribution_skills_verified_by_idx` |
| `profile_counters` | 4 | 4 | 64 kB | `profile_counters_workspace_due_today_count_idx`, `profile_counters_workspace_in_progress_count_idx`, `profile_counters_workspace_inbox_count_idx`, `profile_counters_workspace_overdue_count_idx` |
| `task_pushes` | 4 | 3 | 64 kB | `task_pushes_project_idx`, `task_pushes_pushed_by_idx`, `task_pushes_task_idx` |
| `profile_project_contribution_stages` | 4 | 3 | 56 kB | `profile_contribution_stages_project_idx`, `profile_contribution_stages_verified_by_idx`, `profile_project_contribution_stages_profile_project_idx` |
| `attachment_uploads` | 3 | 2 | 48 kB | `attachment_uploads_conversation_idx`, `attachment_uploads_storage_path_idx` |
| `conversation_participants` | 3 | 3 | 48 kB | `conversation_participants_conversation_idx`, `conversation_participants_my_conversations_idx`, `conversation_participants_user_idx` |
| `dm_pairs` | 3 | 2 | 48 kB | `dm_pairs_user_high_idx`, `dm_pairs_user_low_idx` |
| `message_reactions` | 3 | 3 | 48 kB | `message_reactions_conversation_idx`, `message_reactions_message_conversation_idx`, `message_reactions_user_idx` |
| `onboarding_submissions` | 3 | 3 | 48 kB | `idx_onboarding_submissions_user_id`, `onboarding_submissions_repair_queue_idx`, `onboarding_submissions_status_updated_idx` |
| `profile_project_contributions` | 3 | 3 | 48 kB | `profile_project_contributions_project_idx`, `profile_project_contributions_verified_by_idx`, `profile_project_contributions_verified_idx` |
| `project_markdown_versions` | 3 | 3 | 48 kB | `project_markdown_versions_created_by_idx`, `project_markdown_versions_project_created_idx`, `project_markdown_versions_project_hash_idx` |
| `project_markdowns` | 3 | 3 | 48 kB | `project_markdowns_draft_updated_by_idx`, `project_markdowns_linked_node_idx`, `project_markdowns_project_idx` |
| `project_node_events_2026_07` | 3 | 3 | 48 kB | `project_node_events_2026_07_actor_id_idx`, `project_node_events_2026_07_node_id_idx`, `project_node_events_2026_07_project_id_idx` |
| `project_update_likes` | 3 | 2 | 48 kB | `project_update_likes_update_idx`, `project_update_likes_user_idx` |
| `skill_proposals` | 3 | 3 | 48 kB | `skill_proposals_resolved_skill_id_idx`, `skill_proposals_reviewed_by_idx`, `skill_proposals_status_created_idx` |
| `task_comments` | 4 | 4 | 48 kB | `idx_task_comments_parent_created_at`, `idx_task_comments_task_id`, `idx_task_comments_deleted_by`, `idx_task_comments_user_id` |
| `interests` | 2 | 1 | 40 kB | `interests_name_search_idx` |
| `message_reports` | 5 | 4 | 40 kB | `message_reports_message_conversation_idx`, `message_reports_message_idx`, `message_reports_reporter_idx`, `message_reports_status_idx` |
| `onboarding_events` | 1 | 0 | 40 kB | none |
| `message_attachments` | 2 | 1 | 32 kB | `message_attachments_message_idx` |
| `message_delivery_receipts` | 2 | 2 | 32 kB | `message_delivery_receipts_conversation_idx`, `message_delivery_receipts_user_idx` |
| `onboarding_drafts` | 2 | 2 | 32 kB | `onboarding_drafts_expires_at_idx`, `onboarding_drafts_updated_at_idx` |
| `profile_collaboration_summaries` | 2 | 2 | 32 kB | `profile_collaboration_summaries_refreshed_idx`, `profile_collaboration_summaries_stale_idx` |
| `project_git_deltas` | 4 | 2 | 32 kB | `project_git_deltas_node_idx`, `project_git_deltas_task_idx` |
| `project_markdown_assets` | 4 | 3 | 32 kB | `project_markdown_assets_created_by_idx`, `project_markdown_assets_status_idx`, `project_markdown_assets_version_id_idx` |
| `project_node_events_2026_06` | 2 | 2 | 32 kB | `project_node_events_2026_06_actor_id_idx`, `project_node_events_2026_06_project_id_idx` |
| `project_update_drafts` | 2 | 2 | 32 kB | `project_update_drafts_updated_at_idx`, `project_update_drafts_user_idx` |
| `push_subscriptions` | 4 | 2 | 32 kB | `push_subscriptions_stale_idx`, `push_subscriptions_user_idx` |
| `task_comment_likes` | 2 | 1 | 32 kB | `idx_task_comment_likes_comment_id` |
| `connection_suggestion_dismissals` | 2 | 1 | 24 kB | `connection_suggestion_dismissals_profile_idx` |
| `import_job_files` | 3 | 2 | 24 kB | `import_job_files_status_idx`, `import_job_files_upload_intent_idx` |
| `notification_deliveries` | 3 | 3 | 24 kB | `notification_deliveries_channel_status_time_idx`, `notification_deliveries_notification_idx`, `notification_deliveries_user_time_idx` |
| `project_node_conflicts` | 3 | 3 | 24 kB | `project_node_conflicts_node_idx`, `project_node_conflicts_project_idx`, `project_node_conflicts_task_idx` |
| `project_node_events_2026_01` | 3 | 3 | 24 kB | `project_node_events_2026_01_actor_id_idx`, `project_node_events_2026_01_node_id_idx`, `project_node_events_2026_01_project_id_idx` |
| `project_node_events_2026_02` | 3 | 3 | 24 kB | `project_node_events_2026_02_actor_id_idx`, `project_node_events_2026_02_node_id_idx`, `project_node_events_2026_02_project_id_idx` |
| `project_node_events_2026_08` | 3 | 3 | 24 kB | `project_node_events_2026_08_actor_id_idx`, `project_node_events_2026_08_node_id_idx`, `project_node_events_2026_08_project_id_idx` |
| `project_node_events_2026_09` | 3 | 3 | 24 kB | `project_node_events_2026_09_actor_id_idx`, `project_node_events_2026_09_node_id_idx`, `project_node_events_2026_09_project_id_idx` |
| `project_node_events_2026_10` | 3 | 3 | 24 kB | `project_node_events_2026_10_actor_id_idx`, `project_node_events_2026_10_node_id_idx`, `project_node_events_2026_10_project_id_idx` |
| `project_node_events_2026_11` | 3 | 3 | 24 kB | `project_node_events_2026_11_actor_id_idx`, `project_node_events_2026_11_node_id_idx`, `project_node_events_2026_11_project_id_idx` |
| `project_node_events_2026_12` | 3 | 3 | 24 kB | `project_node_events_2026_12_actor_id_idx`, `project_node_events_2026_12_node_id_idx`, `project_node_events_2026_12_project_id_idx` |
| `project_node_events_default` | 3 | 3 | 24 kB | `project_node_events_default_actor_id_idx`, `project_node_events_default_node_id_idx`, `project_node_events_default_project_id_idx` |
| `recovery_code_redemptions` | 3 | 1 | 24 kB | `recovery_code_redemptions_user_redeemed_idx` |
| `tags` | 1 | 1 | 24 kB | `tags_name_search_idx` |
| `account_deletions` | 2 | 2 | 16 kB | `account_deletions_hard_delete_idx`, `account_deletions_token_idx` |
| `collections` | 1 | 1 | 16 kB | `collections_owner_id_idx` |
| `comment_mentions` | 2 | 1 | 16 kB | `comment_mentions_user_created_idx` |
| `connection_suggestions` | 2 | 1 | 16 kB | `connection_suggestions_suggested_user_idx` |
| `extension_device_sessions` | 1 | 1 | 16 kB | `extension_device_sessions_editor_metadata_idx` |
| `extension_recovery_sessions` | 1 | 1 | 16 kB | `extension_recovery_sessions_updated_idx` |
| `message_read_receipts` | 1 | 1 | 16 kB | `message_read_receipts_conversation_idx` |
| `profile_interests` | 1 | 1 | 16 kB | `profile_interests_interest_idx` |
| `profile_security_states` | 1 | 1 | 16 kB | `profile_security_states_generated_at_idx` |
| `profile_skills` | 1 | 1 | 16 kB | `profile_skills_skill_idx` |
| `project_follows` | 1 | 1 | 16 kB | `idx_project_follows_project_id` |
| `project_markdown_draft_contributors` | 1 | 1 | 16 kB | `project_markdown_draft_contributors_user_idx` |
| `project_members` | 1 | 0 | 16 kB | none |
| `project_node_events_2026_04` | 1 | 1 | 16 kB | `project_node_events_2026_04_actor_id_idx` |
| `project_node_events_2026_05` | 1 | 1 | 16 kB | `project_node_events_2026_05_actor_id_idx` |
| `project_open_roles` | 1 | 1 | 16 kB | `project_open_roles_project_updated_idx` |
| `project_skills` | 1 | 1 | 16 kB | `project_skills_skill_idx` |
| `project_sprints` | 1 | 1 | 16 kB | `project_sprints_creator_idx` |
| `project_tags` | 1 | 1 | 16 kB | `project_tags_tag_idx` |
| `role_skills` | 2 | 0 | 16 kB | none |
| `skill_popularity_snapshots` | 2 | 1 | 16 kB | `skill_popularity_source_rank_idx` |
| `task_node_links` | 1 | 0 | 16 kB | none |
| `upload_intents` | 1 | 1 | 16 kB | `upload_intents_status_expires_idx` |
| `username_aliases` | 1 | 1 | 16 kB | `username_aliases_user_primary_idx` |
| `import_jobs` | 1 | 1 | 8192 bytes | `import_jobs_project_idx` |

## Suggested Implementation Order

1. Align product routing first: delete the sprint compatibility page, make `/settings` the only settings page, and update contracts/tests/baselines so audits stop counting stale route surfaces.
2. Stop unnecessary RSC/network prefetch: project cards, settings tabs/nav, TopNav profile/logo.
3. Remove or bound the 5-second hydration polling loop.
4. Fix or remove the missing `get_mutual_connections` RPC call path.
5. Consolidate notification realtime/count runtime.
6. Gate global providers by route/interaction and prevent heartbeat profile refresh loops.
7. Unmount/gate inactive project detail and task panel tabs.
8. Normalize analytics queries and active-tab fetches.
9. Add actual JS payload budget enforcement.
10. Update stale drift/performance/capacity artifacts.
11. Review zero-scan indexes in small evidence-backed batches.
12. Tighten storage bucket MIME/access/lifecycle decisions.

## Ponytail Net

This audit should reduce code and runtime work rather than add systems:

- Likely deletions: unconditional polling, hidden mounted tab work, duplicate notification channel, missing RPC fallback, stale drift expectations, stale baseline reliance.
- Likely small changes: `prefetch={false}` on existing links, `enabled` guards on existing hooks, one manifest-based budget check.
- Avoid: a new global runtime orchestrator, a new prefetch framework, bulk index dropping, or a custom storage cleanup daemon before built-in bucket controls and reference reconciliation are correct.

Exact net line count is not estimated because no implementation diff was applied in this read-only audit.
