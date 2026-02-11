# Deep QA Matrix (Auth -> Sign Out)

Date: `2026-02-08`  
Scope: `Auth`, `Profile`, `Connections`, `Messages`, `Projects`, `Tasks`, `Files`  
Goal: reliability, architecture simplification, scale safety, data consistency.

## 1. Auth

Scenarios checked:
- Session hydration on app boot.
- `SIGNED_IN` / `SIGNED_OUT` / `TOKEN_REFRESHED` transitions.
- Header sign-out flow.

Findings:
- `AUTH-01` Repeated auth listener churn risk from dependency on current user id, causing avoidable re-subscribes and extra profile fetches.
- `AUTH-02` Header Supabase client recreation per render.

Fixes:
- Stabilized auth listener lifecycle and user tracking using `activeUserIdRef` with cancellation guard.
- Memoized browser Supabase client in top nav.

Changed files:
- `src/components/providers/AuthProvider.tsx`
- `src/components/layout/header/TopNav.tsx`

## 2. Profile

Scenarios checked:
- Public profile initial shell load.
- Profile stats/projects lazy load.
- Connection-state path with mutual connections.

Findings:
- `PROF-01` Mutual connections RPC failure could degrade profile load path.
- `PROF-02` Profile projects query fetched larger row payload than required.

Fixes:
- Added safe fallback (`0`) when mutual RPC fails.
- Reduced selected project fields in profile details heavy-data fetch.

Changed file:
- `src/lib/data/profile.ts`

## 3. Connections

Scenarios checked:
- Accepted connections modal list fetch by target user.
- Privacy gating for target user connections (`public` / `connections` / `private`).
- Cursor/search behavior.

Findings:
- No new critical defect in server action path during this pass.

## 4. Messages

Scenarios checked:
- Message bubble action menu hover/open/close behavior.
- Date-group rendering in thread.
- Conversation list timestamp rendering.

Findings:
- `MSG-01` Message action (three-dots) could remain visually sticky/jerky due hover-only CSS behavior around dropdown open/close transitions.
- `MSG-02` Invalid message timestamps could render poor date labels (`Invalid Date`) in thread or list.

Fixes:
- Added explicit hover state + dropdown open state handling to action visibility.
- Added robust timestamp parsing for thread grouping and conversation relative time rendering.

Changed files:
- `src/components/chat/MessageBubble.tsx`
- `src/components/chat/MessageThread.tsx`
- `src/components/chat/ConversationList.tsx`

## 5. Projects

Scenarios checked:
- Hub project card data path.
- Project detail shell loading by slug/id with schema variance.
- Follow/save/view update paths and count synchronization.

Findings:
- Already addressed in prior pass: schema-drift-safe project reads/writes and fallback recount logic.

## 6. Tasks

Scenarios checked:
- Create task modal attachment selection flow.
- Multi-select behavior in attachment picker.
- Attachment mapping flow from picker to create payload.

Findings:
- `TASK-01` Race window in selection mode: rapid clicks could resolve against stale controlled selection state and collapse multi-select behavior.

Fixes:
- Selection mode now derives latest selected ids from store state first, then normalizes and emits updated selection list.

Changed file:
- `src/components/projects/v2/explorer/FileExplorer.tsx`

## 7. Files

Scenarios checked:
- Explorer selection mode under task-attachment usage.
- Overlay/dialog layering in selection mode.
- Load-more/tree mode behavior integrity.

Findings:
- No additional critical defect beyond `TASK-01` in this pass.

## Validation

Commands run:
- `npm run lint -- --quiet`
- `npm run build`
- `npm run test:e2e -- --reporter=line`

Results:
- Lint: pass
- Build: pass
- E2E: pass with skip (`project-views-follows` test skipped when `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` are not provided)

## Residual risks / next pass

- Full runtime E2E across every authenticated flow still depends on credentialed browser-run matrix.
- Existing codebase still has large non-blocking lint warning surface outside this pass scope.

---

## Pass 2 (Module-by-Module)

Date: `2026-02-08`  
Scope: `Auth`, `Profile`, `Connections`, `Messages`, `Projects`, `Tasks`, `Files`

### Auth

Scenarios checked:
- Login/session hydration + build-time route integrity.
- Sign-out state reset path.

Findings:
- No new critical auth defects found in this pass.

### Profile

Scenarios checked:
- View own profile vs view another user's profile.
- Initial project list data load on profile shell.

Findings:
- `PROF-03` Data-fencing gap: profile project query could return non-public projects when viewing other users.

Fix:
- Added ownership-aware filter:
  - owner sees all own projects.
  - non-owner sees only `public` and non-`draft` projects.

Changed file:
- `src/lib/data/profile.ts`

### Connections

Scenarios checked:
- Connection list modal load/search/pagination path.
- Privacy-gated accepted-connection query path.

Findings:
- No new critical connection defects found in this pass.

### Messages

Scenarios checked:
- Existing pass-1 fixes validated (menu hover/open behavior, timestamp safety).

Findings:
- No new critical message defects found in this pass.

### Projects

Scenarios checked:
- Follow/unfollow, save/unsave consistency path.
- Project lifecycle rendering fallback path.

Findings:
- `PROJ-04` Follow/save action path depended on `ON CONFLICT` behavior; environments with missing unique constraints can fail user actions.
- `PROJ-05` Lifecycle timeline could render empty when lifecycle array exists but is empty in one shape.

Fixes:
- Reworked follow/save write path to be schema-resilient:
  - added per `(projectId, userId)` advisory lock.
  - explicit existence checks before insert/delete.
  - keeps counters idempotent under concurrency and schema drift.
- Hardened lifecycle stage fallback:
  - prefer non-empty `lifecycleStages`.
  - fallback to non-empty `lifecycle_stages`.
  - fallback to defaults if both missing/empty.

Changed files:
- `src/app/actions/project.ts`
- `src/components/projects/dashboard/ProjectOverviewCard.tsx`
- `src/components/projects/dashboard/ProjectDashboardClient.tsx`

### Tasks

Scenarios checked:
- Existing pass-1 multi-select selection-mode behavior (task attachment flow).

Findings:
- No new critical task defects found in this pass.

### Files

Scenarios checked:
- Existing pass-1 selection-mode behavior in explorer-powered attachment flows.

Findings:
- No new critical files defects found in this pass.
