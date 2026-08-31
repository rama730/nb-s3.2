# Files workspace — implemented redesign and acceptance audit

Updated 2026-08-31 after the approved UI/UX correction pass.

Ponytail guided this implementation: reuse the existing file store, React Query, file mutations, dialogs, upload intents, permissions, and Inngest worker. No new dependency, parallel storage model, or UI framework was added. Unrelated worktree changes were preserved.

## Navigation and layout

- Project files, Task files, Deliverables, Recent, Starred, and Trash belong in the **left sidebar**, not a horizontal header strip. Unauthorized task/trash collections are hidden.
- The initial navigation shows collection shortcuts. Project files opens the searchable tree. **Back to Files** restores the shortcuts without replacing the current content.
- Explicit navigation mode survives reload. File and task deep links preserve collection context. Task-group search is kept separately from a task's filename filter, and restored with All tasks.
- Directory and collection scroll positions are retained in memory when opening and returning from a file. Expanded project tree state remains in the existing store.
- Rows use a compact five-column grid: name, modified, size, updated by, actions. Narrow screens hide secondary columns and show compact metadata.
- Each row has an accessible three-dot menu. Project, task and saved collections use the same row/action implementation. There are no permanent checkbox columns or selection toolbars.
- Bulk selection is explicitly entered from List actions, bounded to 200 items, and exited with Done selecting.
- Upload files/folder, New file/folder, search and sort are contextual. A routine Refresh button is not exposed.
- The desktop sidebar remains resizable. Mobile uses a bounded overlay with keyboard focus cycling, Escape, backdrop closing, and focus return.
- File details, versions, linked tasks and GitHub share one inspector selection. Small-screen inspectors use the existing focus-contained dialog/drawer. The inspector is closed until requested.

## Data, search and task navigation

- Task collections read canonical task links and legacy task-owned files. They exclude deleted, detached, inaccessible and cross-project associations.
- Group pages contain 20 tasks, each with up to 50 prefetched file entries. Clicking a listed task uses that first page immediately; additional entries are paginated. Cold loads and binary previews still require network access.
- Task groups, reference/working roles and deliverables retain canonical node IDs. Removing a task association does not delete the original file or its other links.
- Loading, failed reads and genuine empty results are separate states. Existing data remains visible during background refresh.
- Project search, Quick Open and the attachment picker query authorized server pages; cached filenames are not used as the authoritative search universe. Recent entries also resolve through permission-checked metadata.
- Name, updated-time and type sorting run before pagination. Cursors include the selected sort, explicit tie-breakers and validation. Names use the database's normalization on both sides of the comparison.
- Cursor predicates are grouped inside project, deletion and task-visibility filters. Regression tests execute the production predicates for all sort modes against query-local PostgreSQL fixtures.
- Search results identify file paths so repeated filenames can be distinguished.
- Recent and Starred remain browser-local shortcuts, explicitly described as such. No cross-device bookmark promise is made.
- Local mutations invalidate visible collections, picker and Quick Open queries. Existing focus/online reconciliation and bounded, visible-page 60-second refresh keep data current.
- A deliverable label is not treated as proof of approval; the UI does not fabricate a per-file review status.

## Trash, restoration and permanent deletion

- Trash is searchable and paginated. Each item exposes Restore and permission-gated Delete permanently through its menu.
- Single and bulk folder restoration include descendants deleted in the same trash operation. Older deletions remain in Trash. Parent/name conflicts, permissions and leases are checked before mutation.
- Permanent deletion first reviews item, version, task-link and document-link counts. A scope fingerprint requires renewed review if the affected items change before confirmation.
- Only already-trashed, non-system items can be purged. Storage keys must belong to the project. Dependent canonical copies block deletion rather than being silently broken.
- The action commits a durable pending-deletion marker before storage cleanup. Pending files cannot be restored. Failed cleanup remains retryable and is not presented as successful deletion.
- Shared storage keys referenced by other nodes or versions, including trashed nodes, are retained. Version deletion also checks current-node references.
- Cleanup records an audit event that survives node deletion. Task/version rows are removed through database relationships; linked documents are disconnected.
- Existing Inngest infrastructure retries pending roots every five minutes. Failed roots rotate behind other work so one failure does not starve others.
- Operations are deliberately bounded: at most 500 subtree items and 2,000 stored versions/objects per purge. Larger folders must be handled in smaller groups. Restore batches are also bounded.
- Deleting in Edge does not delete anything from GitHub.

## Preview and accessibility

- Document files are not automatically sent to a third-party Google preview service. Unsupported formats offer a direct download.
- PDF object URLs are revoked on teardown, including delayed loads after unmount.
- Preview zoom controls have accessible labels and larger targets.
- Row actions, dialogs, close buttons and navigation controls support keyboard focus. Actions stay inside the available viewport at 390px and 1440px.
- File-version attribution continues to use the shared canonical projection; no unrelated creator is substituted for a missing updater.
- Updated loading skeletons match the sidebar/list layout without reserving space for an always-open inspector.

## Verification performed

- TypeScript and scoped ESLint pass.
- **686 unit/contract/property tests passed**, with zero failures or cancellations, across Files, task-file, storage-key, lease and revision suites. These include source-contract checks and real pure/control-flow tests, not a claim of 686 browser tests.
- Ten cleanup control-flow tests cover shared-object retention, storage failure without DB deletion, idempotent retry, and active/system/foreign/dependent/unapproved/changed/oversized scope rejection.
- Read-only PostgreSQL checks pass for task-role parity, legacy and explicit associations, deleted/foreign/detached exclusion, 70-file pagination, search beyond the first page, and role filtering.
- Additional read-only checks execute production pagination predicates for name, updated and type sorts, both cursor ranks, and directory/search modes. Foreign-project, trashed and private task files remain excluded.
- Signed-out browser checks pass for collection-to-tree-and-back navigation, reload, project search, Quick Open, row menus, file details, drawer Escape/focus behavior and responsive width.
- Normal rows expose no checkboxes; routine Refresh is absent. The public viewer receives no write menu items or private task/Trash collections.
- Document width matches the viewport at 390px and 1440px. The browser's existing signed-out appearance endpoint still reports a 401; no Files-specific runtime error was observed in the checked flows.

## Verification limits and release checklist

The connected browser is signed out and no disposable E2E database is configured. No user files were uploaded, trashed, restored or permanently deleted for testing. No deployment, GitHub push/pull, or live destructive test was performed.

Before release, run the updated authenticated browser acceptance suite against a disposable project/database: owner/member/viewer permissions, task/reference/deliverable navigation, upload retry, bulk operations, conflicting restores, permanent-delete cancellation/confirmation/storage failure, concurrent edits, version restoration and GitHub conflicts. The permanent-delete test now creates and targets only its own disposable file; missing UI fails instead of being treated as optional.

Deploy the registered Inngest function with the app and keep its existing worker endpoint active for automatic deletion retries. The UI also provides explicit retry for pending cleanup. No schema migration is needed for the durable metadata marker.

Existing legacy browser pagination cursors are rejected with a reopen-folder message, not interpreted under a different ordering. Browser-local favorites and bounded first-page prefetch are intentional limits.
