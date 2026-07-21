# Ponytail Global Search Architecture and Implementation Report

Date: 2026-07-13  
Status: Implemented, hardened, and validated  
Scope: Main top-navigation search across Hub, Connections, Messages, Settings, project detail, and all other authenticated routes

## 1. Outcome

The global search control is now one context-aware entry point backed by the existing search engine for each domain:

| Current location | Palette idle input | Result behavior |
| --- | --- | --- |
| Hub | `Search Hub / Projects...` | Shows clickable project previews with match reason, following count, view count, and one connected friend working on the project when available, plus related skill shortcuts; Enter applies the canonical Hub `q` filter. |
| Connections — Discover | `Search Connections / Builders...` | Shows clickable builder-profile previews, then searches all discoverable builders by identity, headline, location, skills, and interests. |
| Connections — Network | `Search Connections / Network...` | Searches the signed-in user's accepted connections. |
| Connections — Requests | `Search Connections / Builders...` | Moves to Discover before searching because Requests is a workflow, not a discovery surface. |
| Messages | Delegates to local search | Does not create a second global message query. It opens the existing local Messages search. |
| Settings | `Search Workspace / Settings...` | Searches a local settings directory and navigates directly to the correct tab. |
| Project detail | `Search Project / Tasks...` | Shows permission-checked task previews, opens a selected task in the existing drawer, or opens the complete Tasks search over title, description, and task key. |
| Other signed-in routes | `Search Hub / Projects...` | Uses Hub project search as the safe default instead of silently doing nothing. |

The implementation adds no search dependency, no generic cross-domain endpoint, no new background process, no database trigger, and no server-side search-history store. Recent searches use one versioned, user-keyed browser-local record capped at five entries per search context. Submitted text remains a text entry; selecting a project, builder, or task stores that exact typed preview entity instead of the partial letters used to find it.

## 2. User concepts translated into product behavior

### 2.1 Hub

- The visible placeholder is project-specific.
- Clicking the header control or pressing `Cmd/Ctrl+K` opens the same dialog.
- Enter writes a normalized `q` value to the Hub URL.
- Existing Hub filters such as view, type, technology, status, sort, and hide-opened remain intact while searching and navigating; the explicit clear action removes the active search/technology dimensions described below.
- A selected skill/technology filter is reflected in the closed header control (for example, `GitHub`) rather than becoming invisible after navigation.
- The closed control exposes one clear action whenever `q`, legacy `tag`, or `tech` is active. Clearing removes those search dimensions and returns to the ordinary Hub result set while preserving unrelated view, type, status, sort, and hide-opened filters.
- The Hub's existing infinite query, pagination, visibility rules, soft-delete exclusion, ranking, and project-card rendering remain authoritative.
- After two characters and a 300 ms debounce, the dialog previews up to six matching projects from that same canonical action.
- Every project preview includes the project name, concise description, owner identity, following count, view count, optional open-role context, and up to six free-standing icon-only skills plus plain `+N` overflow.
- If the signed-in viewer has accepted connections who lead or belong to the project, up to three privacy-safe identities appear in the metadata line using the Team card's canonical terminology. Leads appear as `[name] · Lead / [lead focus]`; collaborators appear as `[name] · [specific role] · [membership role]`. Additional people are summarized as `+N more connections`. The query ranks and counts the cluster per project while returning only three rows, so the preview remains bounded.
- Explicit builder search includes accepted connections on both the Discover tab and the global Connections search. Connections-only profiles remain searchable by their accepted connections, dismissed recommendation state does not suppress a direct name search, blocked relationships remain excluded, and the shared privacy resolver supplies the existing `Connected` label and viewer-scoped profile fields.
- Unconnected builder previews expose a direct `Connect` action. It uses the same `useConnectionMutations().sendRequest` path and success-state presenter as the Discover card, optimistically patches both Discover and global-search caches, changes immediately to the resulting pending/connected state, preserves failure rollback, and never renders for blocked, connected, or pending profiles.
- Generic lifecycle status and last-updated labels are intentionally omitted because they are less useful for project discovery than social proof and engagement context.
- Skills found on the matching projects are deduplicated into clickable `Related skills` shortcuts that open the canonical Hub technology filter.
- Related-skill shortcuts use the same canonical skill-icon resolver as project cards, including branded icons and safe monogram fallbacks.
- Related skills remain on one horizontal row and scroll natively when their combined width exceeds the dialog.
- Clicking a project opens its detail page immediately; pressing Enter without selecting a preview still opens the complete Hub result set.
- Reopening an empty Hub search shows the latest five Hub searches before the existing project-name, technology, and category guidance. A submitted free-text search restores its query; a selected project reuses the canonical project preview card, opens the project directly, and is keyed by project identity rather than by the partial query that found it. Each row/card exposes an individual remove action at its right edge on pointer hover or keyboard focus; touch layouts keep the action visible.

### 2.2 Connections

- The search language explicitly promotes builders and collaborators.
- The top-navigation search is the only search input on Discover and Network; the former duplicate local fields were removed.
- The complete-result page consumes the same canonical `q` URL state produced by the dialog.
- Discover searches full name, username, headline, location, skills, and interests.
- Network searches accepted connections with fuzzy name/username matching.
- Requests never receives a meaningless search query. Searching from Requests changes `tab=requests` to `tab=discover`.
- Manually entering Requests clears a prior discovery query.
- Existing connection privacy, blocked-account exclusion, authentication, cursor pagination, and request-rate controls remain in force.
- On Discover, two characters trigger a 300 ms debounced preview of up to six privacy-eligible builders.
- Each builder preview contains avatar or privacy state, display name, username, headline/location/relationship/activity context, and up to six icon-only skills plus `+N` overflow.
- Clicking a builder opens the canonical public-profile route directly.
- Selecting a builder records that exact privacy-checked builder preview in the scoped recent list. Reopening search therefore shows the selected person—not the two or three letters used to find them—with the same relationship, skills, Connect action, and canonical profile destination as the live preview.
- Preview search never substitutes for the full Connections result page; Enter continues to navigate to the complete discovery result set.

### 2.3 Messages

- The header does not issue message search requests.
- The header does not add `q` to `/messages`.
- The header does not open the general command dialog on Messages.
- Clicking the header search or pressing `Cmd/Ctrl+K` dispatches a local UI event to the page-mode Messages workspace.
- Popup-mode Messages does not respond to the page-header event, preventing two search dialogs from opening.
- The existing Messages dialog remains the single message search UI.
- The existing 250 ms debounce, React Query cache, structured filters, full-text ranking, hidden-message exclusion, deleted-message exclusion, and conversation-membership predicate remain unchanged.

### 2.4 Settings

- Settings search is a navigation directory, not a database query.
- An empty query shows the six primary Settings tabs.
- Typing filters a complete catalog of discoverable controls.
- Results display a title, `Settings › Tab` breadcrumb, and a short explanation.
- Click opens the result.
- Arrow Up and Arrow Down move the active result.
- Enter opens the active result.
- Escape closes the dialog through the existing dialog primitive.
- Search terms such as `change color theme`, `VS Code disconnect`, `quiet hours`, `blocked accounts`, `MFA`, and `push notifications` resolve to the expected tab.
- No Settings `q` parameter is stored because the search query has no meaning after navigation.
- Completed Settings searches are retained only in the signed-in user's browser-local five-entry Settings history; this does not add URL state or a remote query-history record.

### 2.5 Project detail

- The global query switches the project page to `tab=tasks`.
- It removes stale task drawer identifiers before applying a new query.
- The query is stored in the existing `search` parameter.
- Tasks reads that parameter and includes it in its React Query key.
- Filtered queries do not reuse the unfiltered initial page.
- Server search runs only after canonical project read access succeeds.
- Title and description use escaped case-insensitive containment matching.
- Scope (`all`, `backlog`, or `sprint`) and cursor pagination continue to apply.
- A dedicated rate limit protects task-search requests.
- Realtime task updates invalidate active filtered task queries so results cannot remain stale after a task changes.
- After two characters, project detail now shows up to six task previews containing task key, title, description, status, priority, sprint, assignee, due date, and story points.
- Task-key inputs such as `DA-1`, `#1`, and `1` match the project-scoped task number in addition to title and description.
- Opening a task preview switches to the Tasks tab and opens the existing task drawer directly.
- Selected task previews are retained as typed recent items in that project's scoped history and reopen the same permission-checked task destination; plain Enter searches remain ordinary query entries.

### 2.6 Fourteen-stage visual redesign

1. The closed header trigger is stable-width, context-aware, and no longer shifts navigation on hover.
2. The initial shell is compact. It presents up to five context-specific recent searches when available, followed by the existing search dimensions; a first-use browser continues to see only the normal guidance.
3. A one-character query displays one inline instruction without issuing a request.
4. Loading uses three result-shaped skeletons and respects reduced-motion preferences.
5. Project cards have a clean text-first hierarchy with title, owner, description, status, open-role count, recency, and a free-standing icon-only skill rail. Skill icons and the `+N` overflow count have no bubble, border, or background; the repeated generic project/file glyph is intentionally omitted.
6. Related skills remain icon-plus-label filter controls in a single native horizontal scroll row with an overflow fade.
7. Builder cards have a dedicated hierarchy with avatar/privacy state, identity, headline, relationship context, location/activity, and the same free-standing icon-only skill rail.
8. Task cards preview the canonical project task result and open the existing task drawer. The redundant numeric tile and assignee-avatar placeholder are omitted; the visible task key and title remain authoritative.
9. Settings results use dedicated icons, section breadcrumbs, and descriptions without a database request.
10. Keyboard and pointer selection use a quiet neutral surface, precise border, soft elevation, `aria-activedescendant`, `aria-selected`, wraparound movement, and automatic scroll-into-view. The former blue tint and accent rail were removed.
11. Empty results keep the query, name the empty entity type, provide domain-specific recovery terms, and preserve full-search submission through Enter.
12. Error and rate-limit states retain input, distinguish temporary throttling, and offer retry/Enter-to-search recovery.
13. The redundant command footer and visible context header are removed. Idle input text names the context and places a text-only `Esc` control at the far edge; both disappear as soon as the user types, when the compact Enter hint takes over.
14. Mobile uses a full-screen `dvh` command sheet with a pinned header/input, a single vertical result scroller, safe 44px controls, and horizontal related-skill scrolling.

## 3. Root-cause audit

The original control looked complete but only partially connected the layers. The complete root causes were:

1. The visible header control was a button that could only open a dialog; it was not itself a search input.
2. The dialog knew how to write URL parameters but did not know whether a destination actually consumed those parameters.
3. The default context returned no destination, making search silently inert outside recognized routes.
4. Settings had no recognized global-search context.
5. Settings had no searchable directory of tabs or controls.
6. Messages was treated like a normal route search even though it already owned a richer local search.
7. `Cmd/Ctrl+K` could activate both the top-navigation behavior and the Messages shortcut behavior.
8. A global message `q` would not be consumed by the Messages route.
9. Connections accepted global `q`, but Discover and Network stored their query only in local component state.
10. The Connections header and local inputs could therefore show different queries.
11. Refreshing or sharing a Connections search lost local-only state.
12. Switching to Requests preserved a query that Requests could not use.
13. Searching while already on Requests did not identify the appropriate discovery destination.
14. Project search generated `tab=tasks&search=...`, but `TasksTab` never read `search`.
15. Project task data keys did not include a search dimension.
16. Project task server reads did not accept a search input.
17. Filtered project task results could have reused unfiltered initial data.
18. Realtime task cache patches covered scope caches but not filtered variants.
19. Search text was not centrally normalized or length-bounded at the header contract.
20. A new default-route search could have carried unrelated query parameters into Hub.
21. The search dialog had one generic title and description for every domain.
22. Settings results had no keyboard selection model.
23. There was no result breadcrumb explaining where a setting lives.
24. There was no single test contract covering context classification, routing, Messages delegation, Settings intent, and task-server wiring.
25. Discover and Network returned a full loading skeleton before their search inputs, temporarily hiding the canonical query and preventing immediate refinement.
26. Hub search exposed only a generic `Search for` action, so the user could not verify a likely project match before navigating.
27. Connections search exposed no profile identity, avatar, headline, username, or skills in the global dialog.
28. Skills were searchable only after loading Hub; the dialog could not reveal which related technologies produced a project match.
29. There was no direct-result navigation path from the dialog to a project or public profile.
30. Adding raw typeahead requests would have risked a request on every keystroke and duplicated the canonical Hub and Connections security/query contracts.
31. Preview responses needed query- and context-isolated caching so a Hub response could never appear after moving to Connections.
32. The preview interaction lacked loading, empty, error, minimum-input, mouse, and keyboard states.
33. Discover's existing skill/interest predicate treated JSONB columns as native PostgreSQL `text[]`, causing every matching search request to fail with `cannot cast type jsonb to text[]` before any profile could be returned.
34. Even after correcting the JSONB predicate, Discover searched only precomputed `connection_suggestions`; eligible cold-start profiles visible in the normal Discover fallback could disappear as soon as the user typed their exact name.
35. Related skills used one hard-coded tag glyph instead of the existing canonical skill icon catalog.
36. The skill container used `flex-wrap`, and the dialog form retained min-content sizing; the row expanded beyond the dialog rather than creating a constrained horizontal scroll area.
37. Projects, profiles, and Settings were forced through one generic result renderer, flattening entity-specific information.
38. Project/profile skills appeared as noisy text chips inside result rows instead of the canonical icon system.
39. Project-detail search submitted to Tasks but could not preview or directly open a task.
40. The idle and one-character states reserved a large blank result canvas for one line of guidance.
41. Loading used a generic spinner rather than preserving the shape of eventual results.
42. The former Search all action looked like another result and duplicated the input's native Enter submission.
43. Mobile inherited a centered desktop dialog rather than becoming a full-screen command sheet.
44. The selected state depended on a large gray fill and did not provide an accent edge or automatic scroll-into-view.
45. Task search covered title and description but did not recognize the project-scoped task key shown throughout the task UI.

## 4. Architecture

### 4.1 Shared routing contract

`src/components/layout/header/global-search.ts` is the shared client contract. It owns:

- route-to-context classification;
- route-specific placeholder, title, and description;
- search-query normalization and the 100-character ceiling;
- canonical query reading;
- canonical submit URL construction;
- canonical clear URL construction;
- bounded typed recent-search merging, entity/query deduplication, legacy-string migration, and context scoping;
- defensive, versioned browser-local recent-history reads and writes;
- the Settings directory and deterministic local matching;
- the Messages local-search event name.

It does not fetch data, open dialogs, create a server-side store, or own long-lived React state. Browser storage is accessed only through isolated best-effort helpers: privacy mode, quota errors, malformed JSON, and missing identities safely degrade to an empty history without blocking search.

### 4.2 Header controller

`TopNav` owns only open/close behavior:

1. Resolve the current context.
2. If the context is Messages, dispatch the local-search event.
3. Otherwise, open the shared dialog with the current query and context.
4. Use the same function for click, keyboard, and the existing custom palette event.

This removes divergent shortcut paths.

### 4.3 Command surface

`CommandPalette` has three modes:

- preview-and-route mode for Hub, default Hub search, Connections, and project tasks;
- directory mode for Settings.

Messages is deliberately excluded. The responsive shell includes a context rail, prominent input with a conditional Enter hint, one scroll-owning result canvas, entity-specific result cards, and a horizontal related-skill rail. Desktop is top-anchored at a bounded 760px width; mobile is a full-screen `dvh` command sheet.

`src/components/layout/header/GlobalSearchResultCards.tsx` owns the shared selection shell and four explicit card bodies: project, profile, task, and Settings. It centralizes option semantics, selected-state treatment, and open behavior while keeping entity-specific metadata out of one loose generic renderer.

### 4.4 Preview query controller

`src/hooks/useGlobalSearchPreviews.ts` owns only bounded preview orchestration:

- normalize the query through the shared 100-character contract;
- wait 300 ms after the latest input;
- require at least two characters;
- call the existing Hub or Connections action, or the slug-aware wrapper around the shared project-task query, with a six-result limit;
- transform authorized domain records into a discriminated project/profile/task/skill preview union;
- cache each `(context, scope, project identifier, normalized query)` independently, with 60 seconds for Hub, 20 seconds for people, and 5 seconds for project tasks;
- retain unused cache entries for five minutes;
- disable window-focus refetches;
- avoid any query for Messages or Settings contexts.

It does not add an API route, SQL query, table, index, trigger, realtime listener, polling loop, global state store, or search provider.

### 4.5 Canonical state ownership

| Domain | Canonical search state |
| --- | --- |
| Hub | URL `q` |
| Connections | URL `q`, mirrored to the controlled local field |
| Messages | Local Messages dialog state |
| Settings | Ephemeral command-dialog state |
| Project tasks | URL `search` |
| Default | Redirected Hub URL `q` |

The last five completed searches are a secondary convenience layer in versioned `localStorage`, keyed by signed-in user ID and a context scope (`hub`, `people:discover`, `people:network`, `settings`, or a specific project identifier). Matching is case-insensitive for deduplication, the newest entry wins, malformed storage is ignored, and no database, realtime subscription, or global Zustand/Redux store is created. URL state or local dialog state remains authoritative for the active search.

## 5. End-to-end data paths

### 5.1 Hub query path

Preview path: `GlobalSearch` → `CommandPalette` → `useGlobalSearchPreviews` → 300 ms debounce → `fetchHubProjectsAction(limit=6)` → `getHubProjects` → PostgreSQL → project and related-skill preview rows.

For signed-in preview requests, Hub reuses the existing owner privacy relationship batch and performs one ranked, bounded membership query joined to accepted connections. It counts the accepted-connection cluster per project but hydrates at most three privacy-safe identities, allowing the preview to show named collaborators plus a compact `+N more connections` summary without loading complete member lists. Anonymous and non-preview Hub reads do not run this query.

Complete-result path: `GlobalSearch` → `CommandPalette` → `/hub?q=...` → `useHubUrlFilters` → `SimpleHubClient` → `useHubProjectsSimple` → `fetchHubProjectsAction` → `getHubProjects` → PostgreSQL.

The database search checks:

- project title;
- project description;
- project skills;
- project tags;
- project category.

It preserves project visibility/status policy, excludes soft-deleted projects, tokenizes bounded terms, rate-limits search, deduplicates equal in-flight requests, and keeps cursor pagination.

### 5.2 Connections query path

Preview path: `GlobalSearch` → `CommandPalette` → `useGlobalSearchPreviews` → 300 ms debounce → `getConnectionsFeed(tab=discover, limit=6)` → PostgreSQL → privacy-scoped builder profile rows.

Complete-result path: `GlobalSearch` → `/people?tab=...&q=...` → `PeopleHubClient` → controlled local field → 300 ms domain debounce → `useSuggestedPeople` or `useConnections` → `getConnectionsFeed` → PostgreSQL.

Discover searches:

- full name;
- username;
- headline;
- location;
- skill array;
- interest array.

The skill and interest predicates expand only valid JSONB arrays with `jsonb_array_elements_text`. A defensive `jsonb_typeof(...)= 'array'` guard converts null or malformed legacy values to an empty array instead of failing the complete search request. This repairs both preview search and the full Connections search because they share the same action.

An active Discover query searches the complete eligible profile pool rather than only precomputed recommendation rows. It retains self-exclusion, completed-onboarding, soft-delete exclusion, dismissed-profile exclusion, existing-connection exclusion, privacy projection, optional senior/shared-project filters, a bounded page size, and a stable `(updated_at, id)` cursor. The unfiltered recommendation feed continues to use recommendation scores and its cold-start fallback.

Network searches:

- full name similarity;
- username similarity;
- full name containment;
- username containment.

The server validates input with Zod, clamps result sizes, requires authentication, rate-limits searches, isolates query caches by query/filter/sort, and applies cursor pagination.

### 5.3 Messages query path

Header click or `Cmd/Ctrl+K` → `open-messages-local-search` event → page-mode `MessagesWorkspaceV2` → existing local search dialog → 250 ms debounce → `useMessageSearch` → `searchMessages` → PostgreSQL full-text and structured search.

The server search requires the current user to be a conversation participant and excludes:

- soft-deleted messages;
- messages hidden for the current user;
- conversations outside the selected type filter.

It searches message content and structured title/summary fields, supports existing structured chips and message kinds, and ranks full-text matches before recency.

### 5.4 Settings query path

`GlobalSearch` → Settings directory mode → deterministic in-memory token matching → canonical `/settings?tab=...` navigation.

No request, database query, Supabase subscription, or cache entry is created.

### 5.5 Project task query path

Preview path: `GlobalSearch` → current project identifier → `useGlobalSearchPreviews` → 300 ms debounce → `fetchProjectTaskPreviewsAction(limit=6)` → shared `fetchProjectTasksForActor` → project access policy → PostgreSQL → task preview → Tasks tab and existing task drawer.

Complete-result path: `GlobalSearch` → `/projects/[slug]?tab=tasks&search=...` → `ProjectDashboardClient` → `TasksTab` → `useProjectInfiniteTasks` → `fetchProjectTasksAction` → shared `fetchProjectTasksForActor` → project access policy → PostgreSQL.

The task query applies:

- project ID;
- non-deleted task predicate;
- optional title/description/task-number search;
- optional backlog/sprint scope;
- stable `(created_at, id)` cursor;
- bounded page size.

## 6. Complete Settings search inventory

The catalog includes all primary tabs and their user-facing controls:

### Account

- Account
- Delete account

### Security

- Security
- Authenticator app / MFA / 2FA / verification codes
- Password
- Active sessions / signed-in devices
- Login and security activity

### Privacy

- Privacy
- Profile visibility
- Messaging privacy
- Connection request privacy
- Blocked accounts

### Notifications

- Notifications
- In-app notification categories
- Pause notifications
- Quiet hours
- Muted scopes
- Desktop notifications
- Push notifications

### Appearance

- Appearance
- Theme mode: light, dark, and system
- Accent color
- Interface density
- Reduce motion

### Integrations

- Integrations
- Account connections and sign-in providers
- GitHub access
- Editor extension sessions
- VS Code, Cursor, Kiro, and IDE disconnect intent
- Manual editor token

## 7. Interaction and accessibility behavior

- The header trigger remains a real `button` with a context-specific accessible name.
- `Cmd/Ctrl+K` consistently opens the global search even when another ordinary input has focus; Messages still delegates to its own search.
- Click and keyboard use the same controller.
- Messages uses its local dialog and local shortcut semantics.
- The dialog input uses `type=search`, `autocomplete=off`, a 100-character maximum, and an accessible label.
- Settings results use `listbox` and `option` roles.
- Settings, project, profile, and skill results use the same `listbox`/`option` selection contract.
- The active option is communicated with `aria-selected` and `aria-activedescendant`.
- Arrow keys wrap safely through the visible list.
- Arrow navigation begins only when the user presses an arrow key, so an ordinary Enter still submits the full search.
- Enter opens the active project, profile, skill, or Settings result.
- Mouse hover updates the active result; click opens the full clickable row or skill chip.
- Related skills use native horizontal overflow, keep every option at its intrinsic width, and hide only the scrollbar chrome through the shared `AppScrollArea` contract.
- Empty Settings results provide example recovery terms.
- Escape and outside-close behavior remain provided by the existing Radix dialog primitive.
- Result buttons are fully clickable; navigation does not depend on mouse-only hover state.

## 8. URL and history rules

- Hub and Connections use `q`.
- Hub skill/technology selection uses the canonical `tech` parameter and is surfaced as the current query in the header.
- Project tasks use `search` to avoid colliding with tab-specific parameters.
- Messages receives neither parameter.
- Settings receives neither parameter.
- Project submission resets task pagination to page 1 and removes stale task drawers.
- Project clear removes only `search` and resets page 1 only when clearing an active task search.
- Hub clear removes `q`, legacy `tag`, and the active `tech` selection while preserving type, sort, view, status, and hide-opened values.
- Explicit global submissions use `router.push` so the user can navigate back.
- Default-route search starts a clean Hub query and does not leak unrelated profile or page parameters.
- A completed text search, opened result, or selected skill updates only the current user's current-context browser history.
- Histories are deduplicated case-insensitively, ordered newest-first, and capped at five before persistence.
- Removing one recent entry updates only that signed-in user's active context and does not navigate, submit, or affect the remaining history.
- Hub and default-route histories share one scope; Discover and Network remain separate; project histories remain isolated by project identifier.
- Messages does not participate because the dedicated Messages search remains authoritative.
- Storage failures never block navigation, and recent terms are not sent to analytics, Supabase, realtime, or a background process by this feature.

## 9. Loading, empty, error, and stale-data behavior

### Hub

- Fewer than two characters displays a clear minimum-input instruction and performs no request.
- While the debounced request is pending, the dialog shows three result-shaped skeletons instead of a spinner or full-page skeleton.
- No-match and preview-error states preserve full-search submission through Enter in the input.
- Cached prior results remain associated only with their exact context and normalized query.
- React Query retains the previous project page while a new filter is loading.
- Existing Hub empty states and pagination remain responsible for result presentation.
- Server rate-limit and fetch errors propagate through the existing query error path.

### Connections

- Builder previews use the same minimum-input, loading, no-match, error, and full-search fallback states as Hub.
- Query keys separate search, tab, filters, sort, and cursor state.
- Existing loading skeletons and empty states remain active.
- Clearing the field removes `q` and restores recommendations or the network list.

### Messages

- Empty input prompts the user to begin typing.
- Loading, no-match, and result selection states remain in the local Messages dialog.
- No duplicate request is introduced by the header.

### Settings

- Empty input shows up to five Settings recents when available, then the six main sections.
- No-match input shows recovery suggestions.
- Navigation is immediate because no remote read is required.

### Project tasks

- Project detail uses the same compact idle, one-character, result-shaped loading, empty, retry, and rate-limit states as Hub and Connections.
- Task preview caches include the current project identifier, preventing results from one project appearing in another.
- Opening a preview preserves the current project route while switching to the Tasks tab and task drawer.
- Search has its own cache key and does not flash unfiltered initial tasks.
- Existing task loading skeletons remain active.
- The board count explains the active query.
- Active filtered queries refetch after task create/update/delete realtime events.

## 10. Security and privacy audit

- Search input is normalized and capped before routing.
- Connections validates the server payload with Zod and requires an authenticated user.
- Connections search retains privacy and blocked-account rules from the canonical feed action.
- Discover search excludes soft-deleted profiles and expands beyond precomputed suggestions without bypassing dismissal, connection, or viewer-scoped privacy rules.
- Discover expands JSONB skill/interest values only after verifying that each value is an array, preventing malformed legacy profile data from turning into a server error.
- Hub retains visibility, draft, and soft-delete predicates.
- Connected-project context is emitted only for accepted connections, excludes deleted profiles and the viewer, and exposes only the already-authorized display name or username.
- Messages retains conversation-membership checks and per-user hidden-message exclusion.
- Project task search calls the canonical project read-access policy before querying tasks.
- The slug-aware preview action resolves the current project, then delegates to the same actor-scoped task reader as the Tasks tab; it cannot bypass project access.
- Task wildcard characters are escaped before `ILIKE` matching.
- Task search is rate-limited before database work.
- Settings search contains only static UI metadata and never exposes account values.
- No raw database client is added to the browser.
- No public Supabase Realtime publication is added.
- No search telemetry containing user query text is added.

## 11. Performance audit

- No new dependency or client bundle family was added.
- Skill icons reuse `resolveClientSkill` and `SkillIcon`; horizontal scrolling reuses `AppScrollArea` with no custom wheel handler.
- Preview reads require two characters, wait 300 ms, return at most six domain records, and do not refetch on window focus.
- React Query deduplicates equal in-flight preview requests and reuses results for 60 seconds; unused preview caches are removed after five minutes.
- Hub skill suggestions are derived from the already-returned six projects in memory and create no additional SQL request.
- Personalized Hub previews add one bounded, indexed membership/accepted-connection query for at most six project IDs; there is no per-project query or client waterfall.
- The Settings directory is a small static array and performs a bounded in-memory scan only while the dialog is open.
- Messages reuses one existing full-text query instead of issuing a second header query.
- Hub, Connections, and task previews reuse their canonical server actions or shared query core, visibility/privacy/access predicates, bounded queries, deduplication, and rate limits.
- Full builder search and builder previews use the same complete eligible-profile query and stable cursor; there is no preview-only database path.
- Project task search is scoped by project and paginated; unfiltered and filtered caches cannot collide.
- No preview query runs on every global keystroke, before two characters, outside an open dialog, or in an unsupported context.
- Connections has no redundant local typeahead request path; the global dialog owns preview debounce and complete-result navigation.
- No background polling, worker, trigger, materialized view, or Realtime channel was added.

### Deliberate database decision

No task-search index migration was added. The query is always project-scoped, access-checked, rate-limited, and paginated. A dedicated partial trigram or full-text index should be added only if production query plans show large projects making title/description containment slow. Adding an unmeasured index now would increase write cost and migration surface for every task mutation.

## 12. Files audited

### Top-navigation and search UI

- `src/components/layout/header/TopNav.tsx`
- `src/components/layout/header/GlobalSearch.tsx`
- `src/components/layout/header/CommandPalette.tsx`
- `src/components/layout/header/GlobalSearchResultCards.tsx`
- `src/components/layout/header/global-search.ts`
- `src/hooks/useGlobalSearchPreviews.ts`
- `src/components/layout/header/nav-items.ts`
- `src/constants/routes.ts`

### Hub

- `src/app/(main)/hub/page.tsx`
- `src/components/hub/SimpleHubClient.tsx`
- `src/hooks/hub/useHubUrlFilters.ts`
- `src/hooks/hub/useHubProjectsSimple.ts`
- `src/app/actions/hub.ts`
- `src/lib/data/hub.ts`

### Connections

- `src/app/(main)/people/page.tsx`
- `src/components/people/PeopleHubClient.tsx`
- `src/components/people/PeopleClient.tsx`
- `src/components/people/ConnectionsClient.tsx`
- `src/components/people/RequestsTab.tsx`
- `src/hooks/useConnections.ts`
- `src/app/actions/connections.ts`

### Messages

- `src/app/(main)/messages/page.tsx`
- `src/components/chat/v2/MessagesWorkspaceV2.tsx`
- `src/hooks/useMessagingShortcuts.ts`
- `src/hooks/useMessagesV2.ts`
- `src/app/actions/messaging/_all.ts`
- `src/lib/query-keys.ts`

### Settings

- `src/app/(main)/settings/page.tsx`
- `src/components/settings/SettingsLayout.tsx`
- `src/components/settings/AccountSettings.tsx`
- `src/components/settings/SecuritySettings.tsx`
- `src/components/settings/PrivacySettings.tsx`
- `src/components/settings/NotificationsSettings.tsx`
- `src/components/settings/AppearanceSettings.tsx`
- `src/components/settings/IntegrationsSettings.tsx`

### Project detail tasks

- `src/app/(main)/projects/[slug]/page.tsx`
- `src/components/projects/dashboard/ProjectDashboardClient.tsx`
- `src/components/projects/v2/TasksTab.tsx`
- `src/components/projects/v2/tasks/hooks/useTaskFilters.ts`
- `src/components/projects/v2/tasks/TaskFilters.tsx`
- `src/hooks/hub/useProjectTasksData.ts`
- `src/hooks/useRealtimeTasks.ts`
- `src/app/actions/project/_all.ts`
- `src/lib/projects/task-cache.ts`
- `src/lib/query-keys.ts`

### Tests and prior evidence

- `tests/unit/topnav-contract.test.ts`
- `tests/e2e/hub-cursor-integrity.spec.ts`
- `tests/e2e/global-search-contexts.spec.ts`
- `docs/audits/ponytail-main-top-navigation-audit-2026-07-12.md`

## 13. Files changed

- `src/components/layout/header/global-search.ts` — complete context and routing contract plus Settings directory.
- `src/components/layout/header/CommandPalette.tsx` — clickable project/profile/skill previews, full-search fallback, Settings results, keyboard navigation, and accessibility.
- `src/components/layout/header/GlobalSearchResultCards.tsx` — shared selectable result shell plus dedicated project, builder, task, and Settings card anatomy.
- `src/hooks/useGlobalSearchPreviews.ts` — bounded debounced preview orchestration over canonical Hub, Connections, and shared project-task reads.
- `src/app/actions/connections.ts` — corrected JSONB skill/interest matching used by both preview and full Discover search.
- `src/components/layout/header/GlobalSearch.tsx` — context-specific accessible trigger labels.
- `src/components/layout/header/TopNav.tsx` — single click/shortcut controller and Messages delegation.
- `src/components/chat/v2/MessagesWorkspaceV2.tsx` — page-only listener that opens the canonical local search.
- `src/components/people/PeopleHubClient.tsx` — canonical URL/local query synchronization and Requests rules.
- `src/components/people/PeopleClient.tsx` — Discover results without a duplicate local search input.
- `src/components/people/ConnectionsClient.tsx` — Network results without a duplicate local search input.
- `src/components/projects/v2/TasksTab.tsx` — consumes project task search and reports the active query.
- `src/hooks/hub/useProjectTasksData.ts` — filtered cache key and server argument.
- `src/app/actions/project/_all.ts` — one shared actor-scoped, access-checked, rate-limited task query used by full task search and slug-aware previews, including task-key matching.
- `src/lib/query-keys.ts` — isolated filtered task cache keys.
- `src/lib/projects/task-cache.ts` — filtered-query invalidation after task changes.
- `tests/unit/topnav-contract.test.ts` — route, delegation, Settings intent, and backend-wiring contracts.
- `tests/e2e/global-search-contexts.spec.ts` — browser acceptance coverage for Hub, Connections, Messages, and Settings contexts.
- `src/lib/search/query.ts` — shared Unicode normalization, bounded tokenization, and literal wildcard escaping.
- `src/lib/search/contracts.ts` — typed preview failure contract and retry policy.
- `src/lib/search/observability.ts` — sampled, raw-query-free preview metrics.
- `src/constants/settings.ts` — canonical Settings section metadata.
- `scripts/check-global-search-contract.ts` — search index, projection, schema, cache-key, and telemetry guardrail.
- `tests/unit/global-search-query.test.ts` — normalization, token, and wildcard regression coverage.

## 14. Validation

Completed checks:

- `node --test --import tsx tests/unit/topnav-contract.test.ts`
  - 4 tests passed.
  - Covers route classification, URL preservation, Requests routing, Messages non-routing, default Hub routing, Settings intent, and source-level backend wiring.
- Targeted ESLint across every changed TypeScript/React file passed.
- `npm run typecheck` passed with no TypeScript errors.
- Targeted ESLint passed for the preview UI, preview hook, Connections action, and search contract test.
- `git diff --check` passed for every file changed by this implementation.
- `check:skills:visibility` passed for all 1,118 catalog skills.
- `check:query-key-contract` and `check:runtime-boundaries` passed.
- A direct headless Chromium run against the active local app rendered the `Caveman` project preview with its owner and skills, then opened `/projects/caveman?fromTab=projects`.
- A direct headless Chromium run rendered `React` as a related-skill option and opened `/hub?tech=React`.
- A direct Chromium layout check confirmed six of six related skills rendered icons, the row had `overflow-x:auto`, `scrollWidth` exceeded `clientWidth`, `scrollLeft` advanced from 0 to 210, and the dialog itself had no horizontal overflow.
- A post-redesign Chromium check confirmed the compact Hub idle state, inline one-character state, project result cards, icon-only project skill rail, keyboard selection, and bounded desktop shell.
- A post-redesign Chromium check confirmed the builder card opened `/u/ramanayudu_ch` with identity, location/activity, and icon-only skills.
- A post-redesign Chromium check searched `DA-1`, rendered the complete task preview, and opened `/projects/deepscope-ai?tab=tasks&drawerType=task&drawerId=DA-1`.
- A post-redesign Chromium check confirmed Settings card navigation and Messages delegation to the existing local search.
- A 390×844 Chromium check confirmed the command sheet settles at exactly the full mobile viewport with the mobile Back control.
- A post-redesign related-skill check confirmed six of six filter icons, native horizontal overflow, advancing `scrollLeft`, and no dialog-level horizontal overflow.
- A no-result Chromium check retained the query, rendered the domain-specific empty state, accepted Enter submission, and navigated to the canonical complete result URL.
- A simulated server-action failure rendered Preview unavailable, Retry preview, and retained Enter submission without clearing the query.
- A direct headless Chromium run rendered the `Ramanayudu CH` builder preview with username, headline, and skills, then opened `/u/ramanayudu_ch`.
- The first builder browser run exposed the live JSONB-to-`text[]` server failure; after the canonical SQL repair, the same exact interaction passed without a 500 response.
- The earlier complete Hub → Connections → Messages → Settings interaction sequence remains covered by the context E2E specification.
- The normal Playwright runner was also attempted. Its global safety setup correctly stopped before tests because `E2E_DATABASE_URL` was not configured for a disposable fixture database; it did not fall back to the live database.
- `npm run build` was attempted after all search checks. The build is blocked by the pre-existing `/api/e2e/auth` import alias resolving to missing `route-impl` / `route.disabled.ts`; no build error references a global-search change.
- `pnpm typecheck` passed after the hardening follow-up.
- `pnpm check:global-search-contract` passed with seven required index contracts, strict nested inputs, preview projections, centralized cache keys, and redacted metrics.
- `node --test --import tsx tests/unit/global-search-query.test.ts tests/unit/topnav-contract.test.ts` passed all seven tests.
- `pnpm test:unit` passed all 618 tests across 162 top-level test groups with zero failures.
- Targeted ESLint over every global-search hardening file passed with zero warnings and zero errors.
- Scoped `git diff --check` over every file in this implementation passed.
- The updated global-search Playwright spec was attempted; the safety setup correctly refused to seed because `E2E_DATABASE_URL` was not configured as a disposable database.
- A whole-worktree `git diff --check` remains blocked by unrelated trailing whitespace already present in `src/app/api/v1/extension/workspace/route.ts`; that user-owned change was not modified.

## 15. Acceptance checklist

- [x] Hub placeholder and project search work.
- [x] Hub displays clickable project previews before full navigation.
- [x] Hub derives clickable related-skill shortcuts without a second query.
- [x] Every related-skill shortcut uses the canonical skill icon or its canonical fallback.
- [x] Related skills remain in one row and scroll horizontally inside the dialog without making the dialog overflow.
- [x] Hub filters survive query submission and clear.
- [x] Connections placeholder promotes builders and collaboration.
- [x] Connections global and local queries stay synchronized.
- [x] Discover searches identity, skills, interests, headline, and location.
- [x] Discover skill/interest SQL uses guarded JSONB expansion rather than an invalid `text[]` cast.
- [x] Discover search covers all eligible profiles, not only precomputed recommendation rows.
- [x] Discover search excludes soft-deleted profiles and retains stable cursor pagination.
- [x] Connections displays clickable avatar/name/profile previews.
- [x] Network searches accepted connections.
- [x] Requests is not treated as a search result surface.
- [x] Messages global search does not issue a duplicate query.
- [x] Messages click and `Cmd/Ctrl+K` open the local search.
- [x] Settings has a complete discoverable catalog.
- [x] Theme/color intent routes to Appearance.
- [x] Editor/extension intent routes to Integrations.
- [x] Settings results support mouse and keyboard navigation.
- [x] Project task search is consumed end to end.
- [x] Project detail renders task previews with task key, title, description, status, priority, sprint, assignee, due date, and story points.
- [x] Task-key search resolves the current project's task number.
- [x] Selecting a task preview opens the existing Tasks drawer directly.
- [x] Project task search retains access control and pagination.
- [x] Query text is normalized and bounded.
- [x] Preview work is debounced, minimum-length gated, cached, limited, and context isolated.
- [x] Preview loading, no-match, error, mouse, and keyboard states are present.
- [x] Project and builder cards use icon-only skill summaries with tooltips and `+N` overflow.
- [x] Loading skeletons match the result-card anatomy and respect reduced motion.
- [x] The idle and one-character states remain compact.
- [x] Enter submits from the input, its compact hint appears only for a non-empty query, and the redundant command footer is absent.
- [x] Desktop is top-anchored and bounded; mobile is a full-screen `dvh` command sheet.
- [x] Mobile interactive controls meet the 44px minimum target.
- [x] Project, profile, task, and Settings results use dedicated card bodies inside one selectable shell.
- [x] Default authenticated routes have a useful search destination.
- [x] No new dependency, global store, background worker, or duplicate database path was introduced.

## 16. Accepted 20-point hardening implementation

All twenty accepted improvements and the smaller maintainability work are now represented in the implementation:

1. **One normalization boundary:** UI and server actions share NFKC normalization, control-character removal, whitespace collapse, a 100-character ceiling, and safe null handling.
2. **Literal wildcard behavior:** `%`, `_`, and backslash are escaped before `ILIKE`, preventing user input from silently becoming an unbounded wildcard expression.
3. **Bounded multi-word search:** at most eight normalized tokens are evaluated; multi-token project/profile conditions require every token while allowing each token to match an eligible field.
4. **Typed failures:** rate limit, authentication, authorization, validation, not-found, and transient failures use a shared preview error contract. Only transient failures retry, once.
5. **Privacy-safe Discover projection:** active profile search requires public visibility and applies the canonical viewer-scoped projection before returning identity, activity, location, skills, or interests.
6. **Strict nested inputs:** Discover and history filters have explicit strict Zod schemas; the previous `z.any()` boundaries are gone.
7. **Tab-aware people search:** Discover and Network use distinct presentation, query keys, placeholders, ranking paths, and complete-result URLs. Requests redirects search intent to Discover.
8. **No discarded SQL:** an active Discover query bypasses the recommendation query whose rows were previously discarded before the eligible-profile fallback.
9. **Minimal preview projections:** Connections preview skips stats/viewer metadata, Hub preview skips collaborator hydration, and task preview skips creator hydration.
10. **Single project access resolution:** task previews resolve canonical access once by slug or UUID and pass that authorization result into the shared task reader.
11. **Explicit relevance:** projects rank exact/prefix title matches above skill/tag/category/description matches; tasks rank task number, exact title, prefix title, title containment, and description in that order.
12. **Stable ranked cursors:** filtered task pagination carries relevance rank plus creation time and ID, preventing duplicates or skips between equally ranked rows.
13. **Stale-result protection:** old preview results are hidden while the normalized query is debouncing, and context/scope/project/query dimensions cannot share cache entries.
14. **Mobile parity:** mobile navigation exposes a 44px search action and opens the same full-screen `dvh` search sheet.
15. **Lazy UI cost:** the command surface mounts only while open; no hidden search tree, polling loop, listener, or global store remains active.
16. **Combobox accessibility:** input/listbox linkage, expanded/busy state, active descendant, selected options, live status, wraparound keys, reduced-motion skeletons, and safe mobile targets are explicit.
17. **Visible match explanations:** project, builder, and task cards state the safe field or skill responsible for the match without exposing private source data.
18. **Central cache ownership:** global-search query keys live in `queryKeys`; task, project, profile, connection, and privacy mutations invalidate the relevant preview roots.
19. **Canonical Settings navigation:** Settings tabs and section metadata are shared, and every directory leaf uses `settingsTabHref` rather than duplicating URL strings.
20. **Measured operations:** sampled metrics contain only domain, scope, outcome, duration, result count, token count, and a coarse length bucket. A contract check verifies seven existing index requirements and prevents raw-query telemetry.

### Smaller maintainability improvements

- Hub and project hints now describe searchable category/task-key fields accurately.
- The ambiguous `Related skills` heading is now `Skills in these projects`.
- Preview rate-limit responses do not perform a stats query when metadata is disabled.
- Selected-result route prefetch waits 150 ms and is cancelled when selection changes, avoiding eager prefetch of every result.
- Search query keys are generated in one module and mutation invalidation uses scoped roots rather than string literals.
- Settings leaf links use the route helper, and the settings page/layout use one tab metadata source.
- The contract suite checks normalization, token caps, wildcard escaping, nested input schemas, preview projections, index names, cache keys, and raw-query-free telemetry.
- Current project/profile/task index coverage is retained. No speculative migration, materialized view, background worker, semantic-search dependency, or duplicate endpoint was added.

### Measurement gates retained intentionally

Two suggestions were conditional by design and are implemented as gates rather than speculative infrastructure:

- A new task description/full-text index is allowed only when sampled production latency and `EXPLAIN (ANALYZE, BUFFERS)` show the existing project-scoped and title-trigram plan exceeding the search SLO. Existing task/project/profile search indexes are enforced by `check:global-search-contract`.
- Normalized profile skill/interest join tables are not switched into the read path until assignment parity is complete and query plans prove the current guarded JSONB path is the bottleneck. The existing GIN assignment indexes and parity command remain authoritative meanwhile.

## 17. Optional future work, not required for this implementation

These are intentionally excluded until product evidence justifies them:

- A federated result page mixing projects, people, messages, files, and tasks.
- Search history or recent-query persistence.
- A federated typeahead that mixes domains outside the current route context.
- Semantic/vector search.
- Typo correction outside the existing Connections similarity query.
- Search analytics containing raw user query text.
- A task trigram/full-text index before production query plans show the need.

The implemented architecture leaves clear upgrade points without paying those costs now.
