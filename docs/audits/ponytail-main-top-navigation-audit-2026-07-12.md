# Ponytail Main Top Navigation Audit — 2026-07-12

> Historical snapshot from 2026-07-12. Do not use its verification status as current database, migration, capacity, or Supabase evidence; use the 2026-08-13 complete SQL/Supabase audit and a fresh verification run.

Status: implemented and verified on 2026-07-12. All NAV-001 through NAV-035 are closed; the implementation closure is recorded at the end of this report.

Mode: Ponytail full. The recommended fixes below intentionally prefer the smallest root-cause change already supported by the codebase.

Sub-agent note: one sub-agent was launched for an independent top-navigation audit pass. It remained running without returning findings and was interrupted so this report could be delivered. The inventory and findings below come from the primary full trace.

## Scope audited

This audit covers the main application top navigation mounted in the authenticated/main shell:

- Logo and brand navigation
- Workspace indicator and workspace drawer entry
- Desktop nav links: Hub, Connections, Messages, Settings
- Global search / command-palette entry
- Notification bell and tray
- Theme toggle
- Profile avatar link
- Mobile menu
- Supporting client hooks, stores, providers, server actions, API routes, realtime subscriptions, database tables, and dependencies

Page-local headers such as `HubHeader`, project tab bars, and settings side navigation were only reviewed where the main top navigation links into or conflicts with them.

## Active render and data flow

1. `src/app/layout.tsx`
   - Mounts global `SecurityRuntimeProvider`, `ThemeProvider`, `QueryProvider`, `RoutePerformanceObserver`, and `Toaster`.
   - Runs the theme prehydrate script before hydration.

2. `src/app/(main)/layout.tsx`
   - Calls `getViewerAuthContext()`.
   - Passes `initialUser` into `AuthRouteProviders` and `MainRuntimeProviders`.
   - Mounts `MainLayout`.

3. `src/components/layout/MainLayout.tsx`
   - Reads auth state.
   - Mounts `TopNav`.
   - Renders route content inside an overflow-hidden shell.
   - Always renders the dynamic `WorkspaceDrawer`.

4. `src/components/layout/header/TopNav.tsx`
   - Reads `pathname`.
   - Reads auth/profile/sign-out state via `useAuth`.
   - Reads notification state via `useNotifications`.
   - Reads people pending count via `usePeopleNotifications`.
   - Reads scroll shadow via `useScrollShadow`.
   - Registers global `Cmd/Ctrl+K` and `open-command-palette` listeners.
   - Renders desktop nav, search, notification tray, theme toggle, profile link, and mobile menu.

5. Runtime providers under the nav
   - `AuthProvider` syncs browser/server session through `/api/v1/auth/session`.
   - `RealtimeProvider` opens one broad Supabase realtime channel for profile, conversation participants, message visibility, tasks, and user notifications.
   - `PeopleNotificationsProvider` optionally counts pending connections directly from Supabase.
   - `MainRuntimeProviders` starts presence heartbeat and presence publishing.

## Full related file inventory

### Shell and route entry

- `src/app/layout.tsx`
- `src/app/(main)/layout.tsx`
- `src/components/layout/MainLayout.tsx`
- `src/components/providers/AuthRouteProviders.tsx`
- `src/components/providers/MainRuntimeProviders.tsx`
- `src/components/providers/AuthProvider.tsx`
- `src/components/providers/RealtimeProvider.tsx`
- `src/components/providers/PeopleNotificationsProvider.tsx`
- `src/components/providers/query-provider.tsx`
- `src/components/providers/theme-provider.tsx`
- `src/components/providers/SecurityRuntimeProvider.tsx`

### Active top-navigation UI

- `src/components/layout/header/TopNav.tsx`
- `src/components/layout/header/NavLink.tsx`
- `src/components/layout/header/Logo.tsx`
- `src/components/layout/header/WorkspaceIndicator.tsx`
- `src/components/layout/header/GlobalSearch.tsx`
- `src/components/layout/header/NotificationPreview.tsx`
- `src/components/layout/header/MobileMenu.tsx`
- `src/components/layout/header/CommandPalette.tsx`
- `src/components/layout/header/ThemeToggle.tsx`
- `src/components/layout/header/ProfileMenu.tsx`
- `src/components/layout/header/topnav-auth-state.ts`
- `src/components/notifications/NotificationList.tsx`
- `src/components/notifications/NotificationRow.tsx`
- `src/components/notifications/NotificationBundleRow.tsx`
- `src/components/ui/UserAvatar.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/components/ui/sonner.tsx`

### Stale or duplicated navigation UI

- `src/components/layout/MobileNav.tsx`
  - Not imported or mounted anywhere.
  - Contains stale routes and branding that diverge from active `MobileMenu`.

### Hooks

- `src/lib/hooks/use-auth.ts`
- `src/hooks/useAuth.ts`
- `src/hooks/useNotifications.ts`
- `src/hooks/usePeopleNotifications.ts`
- `src/hooks/useRouteWarmPrefetch.ts`
- `src/hooks/useScrollShadow.ts`
- `src/hooks/usePublishOnlinePresence.ts`
- `src/hooks/useSettingsQueries.ts`
- `src/hooks/usePresenceHealth.ts`
- `src/hooks/useOnlineUsers.ts`

### Stores

- `src/lib/stores/ui-store.ts`
- `src/stores/messagesV2UiStore.ts`

### Server actions and API routes

- `src/app/actions/notifications.ts`
- `src/app/actions/connections.ts`
- `src/app/actions/workspace.ts`
- `src/app/actions/account.ts`
- `src/app/actions/extension-sessions.ts`
- `src/app/api/v1/auth/session/route.ts`
- `src/app/api/v1/auth/signup/route.ts`
- `src/app/api/v1/presence/heartbeat/route.ts`
- `src/app/api/v1/appearance/route.ts`
- `src/app/api/v1/security/csrf/route.ts`
- `src/app/api/v1/privacy/route.ts`
- `src/app/api/v1/security/route.ts`
- `src/app/api/v1/integrations/route.ts`

### Server/lib helpers and data model

- `src/lib/server/viewer-context.ts`
- `src/lib/auth/snapshot.ts`
- `src/lib/supabase/client.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/middleware.ts`
- `src/lib/profile/browser-profile.ts`
- `src/lib/data/profile.ts`
- `src/lib/realtime/subscriptions.ts`
- `src/lib/realtime/presence-client.ts`
- `src/lib/realtime/presence-types.ts`
- `src/lib/notifications/service.ts`
- `src/lib/notifications/cache.ts`
- `src/lib/notifications/presentation.ts`
- `src/lib/notifications/preferences.ts`
- `src/lib/notifications/browser-push.ts`
- `src/lib/notifications/web-push.ts`
- `src/lib/notifications/web-push-client.ts`
- `src/lib/notifications/types.ts`
- `src/lib/query-keys.ts`
- `src/lib/theme/appearance.ts`
- `src/lib/theme/appearance-client.ts`
- `src/constants/routes.ts`
- `src/lib/db/schema/index.ts`

### Database tables directly touched by top-nav flows

- `profiles`
  - profile avatar/name
  - `notification_preferences`
  - `last_active_at`
  - appearance metadata through Supabase Auth user metadata, not this table
- `connections`
  - pending connection count
- `user_notifications`
  - notification unread count, tray page, read/dismiss/snooze/mute flows
- `push_subscriptions`
  - notification push delivery preferences
- Supabase realtime channels over:
  - `profiles`
  - `conversation_participants`
  - `message_hidden_for_users`
  - `tasks`
  - `user_notifications`

### Primary dependencies used by the top nav surface

- `next`
- `react`
- `react-dom`
- `lucide-react`
- `@supabase/supabase-js`
- `@supabase/ssr`
- `@tanstack/react-query`
- `zustand`
- `@radix-ui/react-dropdown-menu`
- `next-themes`
- `framer-motion`
- `sonner`

## Findings and end-to-end solutions

### NAV-001 — Notification settings link points to a removed page route

Evidence:

- `src/components/layout/header/NotificationPreview.tsx` links to `${ROUTES.SETTINGS}/notifications`.
- Current settings route inventory only has `src/app/(main)/settings/page.tsx` and resolves tabs through `?tab=notifications`.
- `src/components/settings/SettingsLayout.tsx` uses `/settings?tab=notifications`.

Impact:

- Clicking the notification settings icon from the bell tray can navigate to `/settings/notifications`, which is no longer a real page in the current tab-based settings architecture.

Ponytail solution:

- Change that link to `/settings?tab=notifications`.
- Add a tiny contract check that `NotificationPreview` does not contain `/settings/notifications`.

Validation:

- `npm run build`
- Existing settings matrix should include direct navigation from the bell tray to the notifications tab.

### NAV-002 — Notification bell initial unread count can stay at zero

Evidence:

- `useNotifications` creates `unreadCountQuery` with `enabled: false`.
- The hook invalidates the unread-count key on realtime connect, focus, online, and visibility changes, but invalidating a disabled query does not fetch it.
- `TopNav` uses `useNotifications()` for the bell count.
- `useNotificationUnreadCount()` exists and is correctly enabled for authenticated users, but `TopNav` does not use it.

Impact:

- The bell can show no unread badge until the tray opens or realtime events arrive.
- Users with existing unread notifications may see a false empty state in the top nav.

Ponytail solution:

- Either make `unreadCountQuery` enabled when `isAuthenticated && user?.id`, or use the existing `useNotificationUnreadCount()` for the closed bell and keep full tray pagination gated to `isTrayOpen`.
- Prefer the smallest fix: enable the unread count query inside `useNotifications`, because that preserves the current component contract.

Validation:

- Unit contract: authenticated closed tray should call `readNotificationUnreadCountAction`.
- E2E seed: unread notification exists before route load; bell shows count without opening the tray.

### NAV-003 — Full notification preferences query runs on every main route

Evidence:

- `useNotifications` calls `useNotificationPreferences()` immediately.
- `useNotificationPreferences()` has no `enabled` gate.
- That query calls `readNotificationPreferencesAction`.
- The preferences are only needed for browser delivery and pause/mute interactions, not for rendering a closed bell count.

Impact:

- Every signed-in main route can pay for notification preferences even if the user never opens the tray.
- Signed-out main routes can also execute a server action that returns unauthorized/defaults.

Ponytail solution:

- Add an optional `enabled` parameter to `useNotificationPreferences`.
- In `useNotifications`, enable preferences only when authenticated and either the tray is open or browser notification delivery is actually needed.
- If browser-delivery preferences must be known early, use a small `useNotificationDeliveryPreferences` query with a longer stale time instead of loading the full settings shape.

Validation:

- React Query devtools/network: `/settings notifications` action should not run on a plain `/hub` load with a closed tray.
- Unit contract: `useNotificationPreferences({ enabled: false })` does not invoke action.

### NAV-004 — People/connection pending badges are disabled on most top-nav pages

Evidence:

- `MainRuntimeProviders` sets `enablePeopleRuntime` only for `/people` and `/workspace`.
- `PeopleNotificationsProvider` clears counts when disabled.
- `TopNav` renders the Connections badge from `usePeopleNotifications()`.
- `WorkspaceIndicator` also reads `usePeopleNotifications()`.

Impact:

- Pending connection badges are visible only on `/people` and `/workspace`, not on `/hub`, `/projects/[slug]`, `/messages`, or `/settings`.
- This defeats the purpose of a global top-nav badge.

Ponytail solution:

- If the badge should be global, enable `PeopleNotificationsProvider` for every signed-in main route and keep its query cheap.
- Better root fix: replace the direct Supabase count in `PeopleNotificationsProvider` with one authenticated server action returning `{ pendingConnections, pendingInvites }`, cached through React Query with a 30-60s stale time.

Validation:

- Seed one pending connection.
- Load `/hub`; Connections nav item shows badge.
- Navigate to `/projects/[slug]`; badge stays consistent without an extra full page reload.

### NAV-005 — Workspace badge uses people-notification counts, not workspace counts

Evidence:

- `WorkspaceIndicator` shows `totalPending` from `usePeopleNotifications()`.
- `PeopleNotificationsProvider` currently calculates `pendingConnections + pendingInvites`.
- `pendingInvites` is hard-coded to zero.
- The label is “Workspace,” but the badge represents connection requests.

Impact:

- The Workspace button can display a badge for connection requests, which is semantically wrong.
- Actual workspace task counts are not reflected.

Ponytail solution:

- Remove the badge from `WorkspaceIndicator` unless it is backed by workspace counters.
- If a workspace badge is required, use existing workspace counters from `profiles` (`workspace_inbox_count`, `workspace_due_today_count`, `workspace_overdue_count`, `workspace_in_progress_count`) or one existing workspace action.
- Keep connection badges only on the Connections nav item.

Validation:

- Pending connection should badge Connections only.
- Overdue/due workspace item should badge Workspace only if that product decision is desired.

### NAV-006 — Realtime subscription is broader than the top nav needs

Evidence:

- `RealtimeProvider` is mounted for all main routes.
- `subscribeUserNotifications()` subscribes to:
  - `profiles`
  - `conversation_participants`
  - `message_hidden_for_users`
  - `tasks`
  - `user_notifications`
- Top nav needs `user_notifications` and possibly a narrow profile update, not task and message-visibility events on every route.

Impact:

- All main pages maintain extra realtime bindings.
- More events wake React Query and message attention state even when users are not on Messages or Workspace.
- This can increase client memory, websocket traffic, and render churn.

Ponytail solution:

- Split `subscribeUserNotifications()` into narrow subscriptions:
  - `subscribeNotificationTrayEvents(userId)`
  - `subscribeProfileShellEvents(userId)`
  - `subscribeMessagingShellEvents(userId)`
  - `subscribeWorkspaceTaskEvents(userId)`
- Mount only notification/profile shell realtime globally.
- Mount messaging/workspace task realtime only on `/messages`, `/workspace`, or when the relevant drawer/popup is open.

Validation:

- Instrument channel binding count per route.
- `/hub` should not subscribe to `tasks`, `conversation_participants`, or `message_hidden_for_users`.
- `/messages` should still receive message attention updates.

### NAV-007 — Global presence publishing is mounted outside the area its own docstring recommends

Evidence:

- `usePublishOnlinePresence()` docstring says mount exactly once near the messaging workspace root.
- `MainRuntimeProviders` mounts `PresencePublisher` globally for every main route.
- `MainRuntimeProviders` also starts `/api/v1/presence/heartbeat` every 4 minutes for `initialUser`.

Impact:

- A user appears online across the whole app, not just collaboration/messaging surfaces.
- Every main route opens presence infrastructure.
- Heartbeat starts from the server `initialUser` prop; if client auth later hydrates differently, heartbeat state can drift.

Ponytail solution:

- Move `PresencePublisher` to `ChatProvider` or messaging/workspace surfaces if online presence is only needed there.
- If global online status is intended, update the docstring and keep only one presence mechanism where possible.
- Drive heartbeat from the live `AuthProvider` user rather than only `initialUser`.

Validation:

- On `/hub`, presence realtime room count should be zero unless global presence is explicitly required.
- On `/messages`, presence still publishes once.

### NAV-008 — Workspace drawer chunk is rendered from the shell even when closed

Evidence:

- `MainLayout` always renders dynamic `WorkspaceDrawer`.
- `WorkspaceDrawer` imports `framer-motion`, `WorkspaceOverviewTab`, URL/search-param logic, and workspace task action code.
- It registers Escape and URL-sync effects even while closed.

Impact:

- The top-level shell pays for drawer code and effects on routes where the drawer is never opened.
- This adds unnecessary work to first render.

Ponytail solution:

- Add a tiny `WorkspaceDrawerHost` that reads `isWorkspaceOpen` and `searchParams` for a workspace deep link.
- Only render/import `WorkspaceDrawer` when open or when URL says `drawerType=workspace`.
- Keep the store and button unchanged.

Validation:

- Bundle analysis: workspace drawer chunk should not load on plain `/hub` unless opened.
- Existing deep link `?drawerType=workspace` should still open the drawer.

### NAV-009 — Global search is a button plus placeholder palette, not a working search input

Evidence:

- `GlobalSearch` renders a button, not an input.
- It only reads existing query params.
- Pressing `Cmd/Ctrl+K` opens `CommandPalette`.
- `CommandPalette` is a placeholder with only “Close” and “Command Palette Placeholder.”

Impact:

- The top nav visually says “Search projects...” / “Search messages...” / “Search this project...”, but the user cannot type a query into it.
- Keyboard shortcut opens a non-functional modal.

Ponytail solution:

- Replace the placeholder with the smallest real command/search dialog:
  - one input
  - Escape/close
  - Enter calls existing route behavior from `GlobalSearch`
- Or simpler: make `GlobalSearch` itself an input and delete the placeholder command palette until real command actions exist.
- Do not add a new command-palette dependency; Radix dialog primitives already exist in the project.

Validation:

- E2E: click top search, type query, press Enter, route updates correctly for hub/people/messages/project.
- E2E: `Cmd/Ctrl+K` focuses the same input.

### NAV-010 — `/projects/new` is misclassified as a project-detail page

Evidence:

- `GlobalSearch` uses `(pathname || "").includes("/projects/")`.
- `/projects/new` matches that condition.
- Project context then sets `tab=tasks`, `search`, and `page=1` params.

Impact:

- The Create Project page can show “Search this project...” even though there is no project.
- Enter behavior can mutate create-page URLs with task-tab params.

Ponytail solution:

- Add one small route classifier:
  - project detail: `pathname.startsWith("/projects/") && pathname !== "/projects/new"`
  - or stricter: exactly one slug segment after `/projects/`.
- Reuse that classifier for query parsing, placeholder, and submit behavior.

Validation:

- Unit test: `/projects/new` returns default or hub search context, not project context.
- Unit test: `/projects/deepscope-ai` returns project context.

### NAV-011 — Stale `MobileNav` duplicates and diverges from active mobile navigation

Evidence:

- `src/components/layout/MobileNav.tsx` is not imported anywhere.
- Active mobile nav is `src/components/layout/header/MobileMenu.tsx`.
- Stale `MobileNav` includes obsolete `/explorer` and `/projects` entries and old “Edge” branding.

Impact:

- Future fixes can land in the wrong mobile nav file.
- Route inventory and design audits can count dead navigation as active.

Ponytail solution:

- Delete `src/components/layout/MobileNav.tsx`.
- If some route needs it, wire it explicitly and remove `MobileMenu`; do not keep both.

Validation:

- `rg "MobileNav"` should return no active code after deletion, or exactly one mounted implementation if retained.

### NAV-012 — Mobile menu is missing dialog-level accessibility behavior

Evidence:

- `MobileMenu` uses fixed divs, not a dialog primitive.
- It lacks `role="dialog"`, `aria-modal`, focus trap, Escape close, and body scroll locking.
- Direct sign-out happens from mobile menu without the confirm dialog used in Settings.

Impact:

- Keyboard and screen-reader users can escape behind the menu.
- Focus is not constrained to the open menu.
- Mobile sign-out is easier to trigger accidentally than settings sign-out.

Ponytail solution:

- Reuse an existing dialog/sheet primitive if available.
- If not, add the minimum:
  - `role="dialog"`
  - `aria-modal="true"`
  - Escape listener
  - focus first close/menu item on open
  - restore focus on close
  - lock body scroll while open
- Reuse `ConfirmDialog` for sign-out or remove sign-out from mobile menu and keep it in Settings.

Validation:

- Keyboard-only test: open menu, Tab stays inside, Escape closes.
- Screen reader sees one modal dialog.

### NAV-013 — Desktop nav links do not expose active state to assistive tech

Evidence:

- `NavLink` styles active links visually.
- It does not set `aria-current`.

Impact:

- Screen readers cannot tell which main section is active.

Ponytail solution:

- Add `aria-current={isActive ? "page" : undefined}` to the `Link`.

Validation:

- Unit/DOM assertion: active `/hub` nav link has `aria-current="page"`.

### NAV-014 — Workspace indicator does not expose expanded state

Evidence:

- `WorkspaceIndicator` toggles the workspace drawer.
- It does not set `aria-expanded`, `aria-controls`, or a specific label.
- The drawer has `aria-labelledby="workspace-drawer-title"` but no stable id on the dialog root for `aria-controls`.

Impact:

- Assistive tech users cannot tell whether the workspace drawer is open.

Ponytail solution:

- Give the drawer root `id="workspace-drawer"`.
- Add `aria-controls="workspace-drawer"` and `aria-expanded={isWorkspaceOpen}` to `WorkspaceIndicator`.
- Add `aria-label={isWorkspaceOpen ? "Close workspace drawer" : "Open workspace drawer"}`.

Validation:

- DOM assertion with drawer closed/open.

### NAV-015 — Connection badge is visual-only

Evidence:

- `TopNav` creates a red dot for pending people notifications.
- The badge has no screen-reader text.
- `WorkspaceIndicator` badge has an `aria-label`, but it is nested inside an otherwise unlabeled count context.

Impact:

- Sighted users see pending activity; screen-reader users may not get equivalent information.

Ponytail solution:

- Add an `sr-only` label to the Connections badge such as `${totalPending} pending connection requests`.
- Include that count in the parent link label when non-zero.

Validation:

- Accessibility query can find the count text in the active nav item.

### NAV-016 — Notification tray settings route conflicts with tabbed settings architecture

Evidence:

- Settings tabs use query strings.
- Notification tray uses a path segment.

Impact:

- This is the same user-facing break as NAV-001, but it also shows a route-contract drift between settings and top-nav surfaces.

Ponytail solution:

- Centralize settings tab hrefs in one tiny helper or constant:
  - `settingsTabHref("notifications") -> "/settings?tab=notifications"`
- Use it in `SettingsLayout`, `NotificationPreview`, and any other settings deep links.

Validation:

- `rg "/settings/(account|security|privacy|notifications|appearance|integrations)" src` should return no active links after migration.

### NAV-017 — TopNav has unused imports and dead local variables

Evidence:

- `TopNav` imports `useRouter`, `useCallback`, `createSupabaseBrowserClient`, and `logger`.
- `TopNav` creates `router` and `supabase`, but neither is used.
- ESLint disables unused-var errors globally.

Impact:

- Small but recurring bundle/readability debt.
- Future reviewers can mistake unused setup for required side effects.

Ponytail solution:

- Delete the unused imports and locals.
- Add a focused top-nav contract test or run lint on the touched file after cleanup.

Validation:

- `npm run lint -- src/components/layout/header/TopNav.tsx`

### NAV-018 — Logo sends signed-in users to public `/`

Evidence:

- `Logo` always links to `/`.
- `/` renders the public landing page with “Get Started” and “Sign In.”
- Main nav signed-in primary route is `/hub`.

Impact:

- Signed-in users who click the NB logo can leave the app shell and land on the marketing page.

Ponytail solution:

- Pass `href={authUiState === "signed-in" ? ROUTES.HUB : ROUTES.HOME}` into `Logo`, or make `/` redirect signed-in users to `/hub`.
- Smallest local fix: make `Logo` accept `href` and set it from `TopNav`.

Validation:

- Signed-in logo click lands on `/hub`.
- Signed-out logo click keeps `/`.

### NAV-019 — ProfileMenu file name no longer matches behavior

Evidence:

- `ProfileMenu.tsx` only exports `ProfileAvatar`.
- `TopNav` profile area is a direct link to `/profile`, not a menu.

Impact:

- The file name suggests a menu exists.
- Future work may look for profile menu behavior in the wrong place.

Ponytail solution:

- Rename file to `ProfileAvatar.tsx`, or implement the actual profile menu if product wants one.
- Ponytail preference: rename only if touching nearby imports; otherwise leave until next profile-nav change.

Validation:

- Import path update only; no behavior change.

### NAV-020 — Project/global search contexts mention `/explorer`, but main nav no longer exposes Explorer

Evidence:

- `GlobalSearch` contains an `explorer` context and redirects to `/explorer`.
- `MobileNav` stale file also contains `/explorer`.
- Active top nav does not include Explorer.
- Current app route inventory did not show `src/app/(main)/explorer/page.tsx`.

Impact:

- Dead route logic remains in the top-nav search surface.
- If a user somehow hits an explorer-like path or a future route collision, search can route to a missing page.

Ponytail solution:

- Remove Explorer context from `GlobalSearch` unless the route is restored.
- Keep route contexts aligned with actual `src/app/(main)` routes.

Validation:

- `rg "/explorer|explorer" src/components/layout src/constants src/app` returns no active top-nav references unless an Explorer route exists.

### NAV-021 — Global keyboard shortcut does not use `event.key.toLowerCase()`

Evidence:

- `TopNav` checks `(e.metaKey || e.ctrlKey) && e.key === "k"`.

Impact:

- Some keyboard layouts or Shift-modified events can produce uppercase `K`, missing the shortcut.

Ponytail solution:

- Compare `e.key.toLowerCase() === "k"`.

Validation:

- Unit or manual keyboard check for `Cmd+K` and `Cmd+Shift+K`.

### NAV-022 — Command palette has no escape handling or accessible dialog structure

Evidence:

- `CommandPalette` is a fixed overlay with a close button and placeholder text.
- No `role="dialog"`, no `aria-modal`, no title, no Escape handler.

Impact:

- Accessibility issue.
- Keyboard users can open the palette but do not get proper modal behavior.

Ponytail solution:

- If keeping it, use the same dialog primitive used elsewhere.
- If not implementing real command search now, remove the global shortcut and placeholder to avoid a fake feature.

Validation:

- `Cmd/Ctrl+K` opens a real dialog with focus in an input, or does nothing because the feature is intentionally absent.

### NAV-023 — Notification tray filter buttons use `aria-pressed`, but this is semantically a tab switch

Evidence:

- `NotificationPreview` uses two buttons for `Unread` and `All`.
- They change tray content.

Impact:

- Minor accessibility semantics gap.

Ponytail solution:

- Either keep buttons and add clear labels, or use `role="tablist"` / `role="tab"` if treating this as tabbed content.
- Smallest acceptable fix: leave `aria-pressed`, because it is functional and understandable, unless an accessibility sweep touches the tray.

Validation:

- Screen reader announces current filter state.

### NAV-024 — Notification tray “Mark all read” has no pending state

Evidence:

- `NotificationPreview` receives mutation functions but not pending flags.
- `Mark all read` is disabled only when `unreadCount === 0`.

Impact:

- Users can double-click and fire duplicate mutations before the optimistic cache update disables the button.

Ponytail solution:

- Return mutation pending flags from `useNotifications`.
- Disable action buttons while their mutation is pending.

Validation:

- Double-click “Mark all read” should issue one server action.

### NAV-025 — People pending count uses direct browser Supabase rather than the app action/query-key layer

Evidence:

- `PeopleNotificationsProvider` queries `supabase.from("connections").select("id", { count: "exact", head: true })`.
- Most other app data flows use server actions plus React Query cache keys.

Impact:

- Count behavior depends on browser RLS and cannot be centrally logged, retried, or cached the same way as server actions.
- It duplicates connection logic already present in `src/app/actions/connections.ts`.

Ponytail solution:

- Create one tiny `readPeoplePendingCountsAction()` or reuse an existing connections stats action.
- Fetch it through React Query with a single query key.
- Keep realtime refresh optional.

Validation:

- Pending count works with RLS and with server-side auth.
- Failed count logs server-side once instead of retry-looping only in browser.

### NAV-026 — Pending invites are modeled but never loaded

Evidence:

- `PeopleNotificationsProvider` has `pendingInvites`, but it is `useState(0)` with no setter use.
- `totalPending` includes `pendingInvites`.

Impact:

- The data shape says project invites count toward top-nav pending state, but the value is always zero.

Ponytail solution:

- Either remove `pendingInvites` from this provider or implement it in the same server action as pending connection counts.
- Do not keep a permanently-zero public field.

Validation:

- If invites are in scope, seed invite and see badge.
- If not in scope, type no longer exposes `pendingInvites`.

### NAV-027 — Header height is set through an effect instead of static CSS

Evidence:

- `TopNav` sets `document.documentElement.style.setProperty("--header-height", "var(--ui-topnav-height)")` on mount.

Impact:

- Any code reading `--header-height` before hydration can get a missing value.
- This is unnecessary client work for a static alias.

Ponytail solution:

- Move the alias to CSS: `:root { --header-height: var(--ui-topnav-height); }`.
- Delete the effect.

Validation:

- No visual shift before/after hydration.

### NAV-028 — Scroll shadow has a retry loop per route

Evidence:

- `useScrollShadow` retries up to 20 animation frames until it finds `[data-scroll-root="route"]`.
- It falls back to `window`.

Impact:

- Minor work on every route change.
- Inconsistent shadow behavior if a route root appears after the retry window.

Ponytail solution:

- Keep it if needed; it is small.
- If optimizing shell render, prefer a shared scroll-root context or dispatch a simple custom event from `AppScrollArea` when mounted.

Validation:

- Header shadow appears correctly on hub, project detail, settings, messages.

### NAV-029 — Active-route matching is string-prefix based

Evidence:

- TopNav uses `pathname?.startsWith(item.href)`.
- MobileMenu uses the same broad prefix style.

Impact:

- Works for current routes, but can false-positive if future routes share a prefix (`/settings-old`, `/people-search`, etc.).

Ponytail solution:

- Use a tiny helper: active when `pathname === href || pathname.startsWith(href + "/")`.
- This helper already exists in stale `MobileNav`; reuse that logic.

Validation:

- `/settings` and `/settings?tab=...` active.
- `/settings-old` not active.

### NAV-030 — TopNav and MobileMenu duplicate nav item definitions

Evidence:

- `TopNav` defines `navItems`.
- `MobileMenu` defines `NAV_ITEMS`.
- They currently match, but are separate arrays.

Impact:

- Future nav changes can update desktop but miss mobile.

Ponytail solution:

- Move the four active items to one small exported constant in `TopNav` or `constants/routes`.
- Reuse in both desktop and mobile.

Validation:

- One source contains Hub, Connections, Messages, Settings.
- No duplicate nav arrays with those labels.

### NAV-031 — The search clear action drops all query params outside project context

Evidence:

- `GlobalSearch.handleClear` pushes `targetPath` for non-project contexts.
- On Hub, clearing a `q` query also removes filters such as `sort`, `type`, `tech`, or `hideOpened`.

Impact:

- Clearing only search can reset unrelated filters.

Ponytail solution:

- Delete only `q` and `tag` for hub/people-like contexts.
- Preserve unrelated query params.

Validation:

- `/hub?q=react&type=startup&sort=popular` clear becomes `/hub?type=startup&sort=popular`.

### NAV-032 — Project search clear forces `page=1` even when only clearing search

Evidence:

- Project clear deletes `search` and sets `page=1`.

Impact:

- This is probably intended for task pagination, but it affects any project tab URL that carries `page`.

Ponytail solution:

- Only reset `page` when currently on `tab=tasks`, or when the `search` param existed.

Validation:

- Non-task project tabs keep their pagination/query state.

### NAV-033 — Notification read actions couple bell behavior to messaging server actions

Evidence:

- `markNotificationReadAction` and `markAllNotificationsReadAction` call `markMessageBurstConversationsRead`.
- That dynamically imports `@/app/actions/messaging/_all`.

Impact:

- A bell action can trigger messaging read-side effects and a large server-action module import.
- This may be correct product behavior, but it is hidden coupling.

Ponytail solution:

- Keep behavior, but move message-burst sync into a small notification service helper that imports only the minimal messaging read function.
- Add a comment/contract test documenting that message-burst notifications mark conversations read.

Validation:

- Mark message notification read updates both notification and conversation read state.

### NAV-034 — Notification realtime health starts as healthy before a subscription exists

Evidence:

- `useNotifications` initializes `isRealtimeHealthy` to `true`.
- It then mirrors `RealtimeProvider.isConnected`.
- Before auth/session realtime connects, the bell appears healthy.

Impact:

- The reconnecting indicator may not show during initial setup.

Ponytail solution:

- Represent three states: `pending`, `connected`, `disconnected`, or initialize to `Boolean(isConnected)` once authenticated.
- Smallest fix: initialize to `false` for authenticated users until realtime connects, but avoid alarming signed-out users.

Validation:

- Slow realtime connection shows a non-blocking “connecting” or no health dot until ready.

### NAV-035 — Top nav has limited direct contract coverage

Evidence:

- Existing top-nav unit coverage only tests `resolveTopNavAuthUiState`.
- E2E coverage checks the hub search button visibility, but not the full top-nav behavior.

Impact:

- Regressions like `/settings/notifications`, zero unread counts, or fake command palette can ship.

Ponytail solution:

- Add one low-cost contract test file for:
  - settings notification href
  - shared nav items
  - no stale `/settings/notifications`
  - `/projects/new` not project search context
  - `aria-current` present in `NavLink`
- Add one E2E smoke for: search opens, mobile menu opens/closes, notification settings navigates to `?tab=notifications`.

Validation:

- `node --test --import tsx tests/unit/topnav-contract.test.ts`
- Existing critical E2E remains green.

## Recommended implementation order

1. Fix broken user-facing links and route classification:
   - NAV-001 / NAV-016
   - NAV-010
   - NAV-018

2. Fix counts and badges:
   - NAV-002
   - NAV-004
   - NAV-005
   - NAV-025
   - NAV-026

3. Remove fake/stale navigation:
   - NAV-009
   - NAV-011
   - NAV-020
   - NAV-030

4. Reduce background work:
   - NAV-003
   - NAV-006
   - NAV-007
   - NAV-008
   - NAV-027

5. Accessibility and polish:
   - NAV-012
   - NAV-013
   - NAV-014
   - NAV-015
   - NAV-021
   - NAV-022
   - NAV-023
   - NAV-024
   - NAV-028
   - NAV-029
   - NAV-031
   - NAV-032
   - NAV-033
   - NAV-034
   - NAV-035

## Minimal acceptance checklist

- Top nav notification settings goes to `/settings?tab=notifications`.
- Bell count is correct on initial load with unread notifications.
- Connections badge works from `/hub`, `/projects/[slug]`, `/messages`, and `/settings`.
- Workspace badge either reflects workspace counters or is removed.
- `/projects/new` does not show project-detail search behavior.
- `Cmd/Ctrl+K` opens a real input/dialog or the shortcut is removed.
- Dead `MobileNav` is removed or explicitly mounted as the only mobile nav.
- Mobile menu is an accessible dialog.
- Active nav links expose `aria-current`.
- Top nav no longer opens broad realtime/task/message subscriptions on pages that do not need them.
- Workspace drawer code does not load until opened or deep-linked.
- One top-nav contract test covers route links, search contexts, and nav item parity.

## Implementation closure — 2026-07-12

| Finding | Implemented result |
| --- | --- |
| NAV-001 | Notification settings now resolves through `settingsTabHref("notifications")` to `/settings?tab=notifications`. |
| NAV-002 | The authenticated unread-count query is enabled before the tray opens. |
| NAV-003 | Notification preferences are deferred until the authenticated user opens the tray. |
| NAV-004 | Pending people counts are enabled globally for signed-in main routes. |
| NAV-005 | The Workspace control no longer shows connection-request counts. |
| NAV-006 | The global realtime channel now binds only profile and notification events; messages keep their dedicated subscription. |
| NAV-007 | Presence publishing and its heartbeat now mount only with the Messages runtime, using live client auth. |
| NAV-008 | `WorkspaceDrawerHost` imports the drawer only when it is open or workspace-deep-linked. |
| NAV-009 | The placeholder palette is a real Radix dialog with an autofocus search input and Enter route submission. |
| NAV-010 | Project search uses an exact project-detail route classifier, excluding `/projects/new`. |
| NAV-011 | The unmounted, divergent `MobileNav` component was removed. |
| NAV-012 | Mobile navigation now uses the existing modal dialog primitive and confirms sign-out. |
| NAV-013 | Active desktop links expose `aria-current="page"`. |
| NAV-014 | The Workspace trigger exposes its expanded state, label, and drawer relationship. |
| NAV-015 | The Connections link has an accessible pending-request count when the badge is visible. |
| NAV-016 | Settings tab URLs are centralized in `settingsTabHref` and reused by the settings UI and tray. |
| NAV-017 | Dead TopNav imports, locals, and the hydration-only header-height effect were deleted. |
| NAV-018 | Signed-in logo clicks now return to `/hub`; signed-out clicks remain on `/`. |
| NAV-019 | `ProfileMenu.tsx` was renamed to the behavior-aligned `ProfileAvatar.tsx`. |
| NAV-020 | Dead Explorer navigation references were removed with the stale navigation components. |
| NAV-021 | The shortcut checks `event.key.toLowerCase()` for Cmd/Ctrl+K. |
| NAV-022 | The command search now has Radix dialog semantics, focus management, and Escape handling. |
| NAV-023 | Notification filters now use tablist/tab/tabpanel semantics. |
| NAV-024 | Mark-all-read is disabled and labeled while its mutation is pending. |
| NAV-025 | People counts are read by one authenticated server action through a React Query key. |
| NAV-026 | Pending project invites are counted from pending `message_workflow_items`, not hard-coded to zero. |
| NAV-027 | `--header-height` is declared statically in `:root`. |
| NAV-028 | The 20-frame scroll-root retry was replaced by a route-scroll-root-ready event. |
| NAV-029 | Desktop and mobile active-state matching share an exact-or-child-route helper. |
| NAV-030 | Desktop and mobile navigation consume one `MAIN_NAV_ITEMS` declaration. |
| NAV-031 | Clearing hub/people/message search preserves every unrelated query parameter. |
| NAV-032 | Clearing a project search resets pagination only for the Tasks tab. |
| NAV-033 | Message-burst read synchronization is isolated in `lib/notifications/message-burst-read.ts`; notification actions no longer dynamically import messaging `_all`. |
| NAV-034 | Realtime health begins disconnected and turns healthy only after subscription. |
| NAV-035 | Added `tests/unit/topnav-contract.test.ts` plus a focused people-count provider contract. |

Verification completed:

- `node --test --import tsx tests/unit/topnav-contract.test.ts tests/unit/people-notifications-provider.test.ts tests/unit/topnav-auth-state.test.ts`
- Focused ESLint for every changed navigation, provider, hook, action, and test file (no errors)
- `npm run build`
- Final source sweep for all obsolete patterns listed in the findings
