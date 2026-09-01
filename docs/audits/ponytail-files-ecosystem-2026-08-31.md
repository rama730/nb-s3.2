# Files workspace — implemented redesign and acceptance audit

Updated 2026-08-31 after the approved UI/UX correction and follow-up implementation passes.

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
- A deliverable label is not treated as proof of approval. The explicit lead review action now snapshots each finalized, directly linked deliverable's version and revision timestamp. A new version **or an overwrite of the active version** requires fresh review. Approval metadata belongs to the task–file link; ordinary label edits cannot forge it or erase concurrent approval. Legacy files without a snapshot display “Review not recorded”. Folders and indirect/legacy associations are not falsely marked individually approved.

## Follow-up implementation

- File-only and folder-only pickers filter on the server before pagination. A page full of folders can no longer hide matching files in Quick Open, nor can files hide folders in the move picker.
- Updated-time sorting uses the same current-version timestamp displayed in the row, including the pagination cursor.
- Opening a task found through group search reuses its prefetched first file page. Subsequent pages retain the server's order.
- Attaching an existing file offers explicit Reference, Working file and Deliverable roles. Search failures show Retry, loading is distinct from empty, and saving disables duplicate selection. Native radio controls provide keyboard role selection.
- Flat uploads offer Skip existing, Keep both, and Cancel through the shared accessible dialog. Keep both checks persisted names, reserves case-insensitive suffixes and preserves extensions. Folder imports reuse existing folders and skip existing files. Revision upload remains a distinct action, with keyboard-accessible new/active revision choices and an explicit overwrite warning.
- Rename, move and Trash expose Undo through existing notifications instead of an invisible operation log. Rename Undo checks the last-write timestamp, move Undo checks expected location, and Trash Undo restores only this operation's selected roots and checks the deletion timestamp. Creation is not automatically undo-trashed because another collaborator may already have added content.
- Trash rows show deletion actor and original location. The unused alternate sidebar Trash reader was removed.
- Linked-task popovers reuse installed Radix positioning, viewport collision handling and focus/dismissal. Links are keyboard-accessible. Deliverables use an output icon rather than an approval-check icon; revision upload uses a file-upload icon rather than a refresh symbol.
- Review approval invalidates the task-files collection cache even while the Files tab is unmounted. File revision uploads notify the existing collection-refresh pipeline.

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
- The latest follow-up sweep passed **670 unit/contract/property tests**, with zero failures or cancellations, across the selected Files, task-file, lease and revision suites. These include source-contract checks and real pure/control-flow tests, not browser tests. The suite selection and removal of dead fuzzy-ranking tests differ from the prior 686-test run.
- Ten cleanup control-flow tests cover shared-object retention, storage failure without DB deletion, idempotent retry, and active/system/foreign/dependent/unapproved/changed/oversized scope rejection.
- Read-only PostgreSQL checks pass for task-role parity, legacy and explicit associations, deleted/foreign/detached exclusion, 70-file pagination, search beyond the first page, and role filtering.
- Additional read-only checks execute production pagination predicates for name, updated and type sorts, both cursor ranks, and directory/search modes. Foreign-project, trashed and private task files remain excluded.
- Signed-out browser checks pass for collection-to-tree-and-back navigation, reload, project search, Quick Open, row menus, file details, drawer Escape/focus behavior and responsive width.
- Normal rows expose no checkboxes; routine Refresh is absent. The public viewer receives no write menu items or private task/Trash collections.
- Document width matches the viewport at 390px and 1440px. The browser's existing signed-out appearance endpoint still reports a 401; no Files-specific runtime error was observed in the checked flows.

## Verification limits and release checklist

The connected browser is signed out and no disposable E2E database is configured. No user files were uploaded, trashed, restored or permanently deleted for testing. No deployment, GitHub push/pull, or live destructive test was performed. The latest read-only browser smoke test reconfirmed zero default checkboxes, no routine Refresh button, viewer-safe menus, sidebar Back/Escape/focus return, and no horizontal page overflow at 390px and 1440px.

Before release, run the updated authenticated browser acceptance suite against a disposable project/database: owner/member/viewer permissions, task/reference/deliverable navigation, upload retry and collision choices, Undo after concurrent changes, approval followed by active-revision overwrite, bulk operations, conflicting restores, permanent-delete cancellation/confirmation/storage failure, version restoration and GitHub conflicts. The permanent-delete and revision-upload tests create and target only their own disposable files; missing UI fails instead of being treated as optional. The revision test explicitly confirms the new-revision choice and verifies that both versions remain in history.

Deploy the registered Inngest function with the app and keep its existing worker endpoint active for automatic deletion retries. The UI also provides explicit retry for pending cleanup. No schema migration is needed for the durable metadata marker.

Existing legacy browser pagination cursors are rejected with a reopen-folder message, not interpreted under a different ordering. Browser-local favorites and bounded first-page prefetch are intentional limits.

## Compact Files controls follow-up — 2026-08-31

Implemented the approved compact layout using Ponytail's shared-root/reuse approach:

- One 48px workspace header owns breadcrumbs, sidebar reopening, active filter/selection status and the contextual actions menu. Closing the sidebar does not create a new row.
- Removed persistent sidebar search, listing search, Upload/New/Sort toolbars, collection headings and preview action strips. Existing upload, create, sort, selection, GitHub, task-role and preview handlers remain available through menus. Details remains on demand; editor Save/Cancel stays directly available in the same header.
- Search reuses Quick Open for project-wide filenames/folders, with explicitly submitted collection search elsewhere. Query chips stay in the existing header. Applied queries no longer wait behind an obsolete input debounce; opening a folder from results exits search. Task headings are keyed to task identity and role filters only restore in the task-file scope.
- Verification found and fixed a menu-to-dialog pointer-lock/focus race. Menus do not own modality; dialogs do. Search opens after the menu focus scope closes and focuses its input. The global Quick Open shortcut does not stack another dialog over an existing on-demand surface.
- Retained prefetch, authorized reads, pagination, explicit loading/error/retry states, dirty-edit guards and destructive confirmations. No new dependencies or schema changes.

Verification for this follow-up (a narrower selection than the earlier 670-test sweep):

- `node --import tsx --test tests/unit/files-tab/*.test.ts tests/unit/files-tab/properties/*.test.ts`: **602 passed**, zero failures/skips.
- `tests/e2e/files-tab/compact-workspace.spec.ts`: **3 passed** in Chromium, using an isolated read-only config against the public project. Covers stable header position/height, absent inline controls, 390px layout, search focus/apply/clear/Escape, pointer-lock release, sidebar reopening and collection search.
- TypeScript, scoped ESLint and `git diff --check`: passed.
- Additional browser checks: sorting, project search results, file Details and mobile dialog closure; document width did not exceed 390px/1440px. The existing signed-out appearance 401 remains unrelated.
- Authenticated task/deliverable/Trash and write flows still need the disposable-environment acceptance checks above. No user files were uploaded, modified or deleted during this verification.

## Recovery, consistency and caching follow-up — 2026-08-31

Implemented using Ponytail's shared-path approach, without new dependencies or schema changes:

- Search-to-preview navigation preserves an explicit **Back to search results** action. Clicking a containing folder or breadcrumb exits the filename filter only after navigation succeeds. Cancelled dirty-file navigation leaves the search intact; deep links and history restoration retain their explicit query context.
- Opening a linked task carries a bounded, allowlisted, same-project Files return context. Closing the task restores the original collection, task, query, file and inspector. Cross-tab, document, ordinary-link and browser-history exits now guard dirty file edits.
- Task collections keep first **and subsequent** file pages in React Query. Revisiting a task reuses its pages instead of resetting a separate local pagination buffer. Overlapping pages deduplicate canonical file IDs. Group-prefetched first pages still show immediately; a cold network read or file preview is not claimed to be instantaneous.
- Linked-task panels and chips share a project/file-keyed query with foreground reconciliation. Link/note/revision changes notify the existing refresh pipeline. Failed note saves retain the input and show an inline error; a successful write is not reported as failed just because the subsequent refresh fails.
- File preview menus reuse the existing rename, move, Trash, confirmation and Undo implementation used by listings. Preview operations explicitly target the current file, never a stale bulk selection. Preview Star/Unstar remains a browser-local shortcut.
- File rows and task attachments use shared size/date/actor formatting. An unknown size is not displayed as zero bytes; an unavailable updater is **Not recorded**, not an unrelated creator. Details expose the exact timestamp and timezone. MIME fallback gives extensionless images, documents and other supported types appropriate icons.
- Sort indicators announce the active order, selected rows announce selection, touch tree targets expand without changing desktop density, and task attachment/note actions no longer depend on hover. Internal task navigation uses an internal arrow rather than an external-link icon.
- Preview/inspector reads expose retry. Markdown and signed-URL queries respond to revision changes. Version restoration records the actual returned revision and invalidates task-file views; task review status and individual deliverable approval remain distinct.
- An open editor freezes its loaded revision basis so realtime updates cannot replace its draft. Lost editing access can be retried in place. Failed saves keep the draft, show a persistent error and offer **Download draft**. Revision drops are rejected while editing; comparison and document navigation require resolving unsaved changes.
- **Transfers…** opens a compact session-local progress/retry dialog; only active progress occupies the existing header. Folder picking and folder drop share one upload implementation. Partial worker failures preserve confirmed successes and retry unfinished files. The mutation queue now remains active until the upload worker finishes, and no-op collision races do not leave a transfer permanently marked running.

### Verification of this follow-up

- `node --import tsx --test tests/unit/files-tab/*.test.ts tests/unit/files-tab/properties/*.test.ts tests/unit/task-working-files-presentation.test.ts`: **619 passed**, zero failures/skips. Includes eight new recovery checks: return-context round trips/validation, metadata, MIME icons, discard cancellation, editor/note contracts, cached pagination, and executable worker partial-failure/retry behavior.
- `tests/e2e/files-tab/compact-workspace.spec.ts`: **5 passed** in Chromium against the public project. Adds search → preview → search and search → preview → containing-folder checks, plus mobile Transfers open/close and menu usability. Existing stable-header, no-inline-toolbar and search-focus checks also pass.
- `FILES_COLLECTION_READONLY_AUDIT=1 node --env-file=.env.local --import tsx --test tests/integration/files-collection-readonly.test.ts`: **2 passed**. Query-local fixtures in read-only transactions verify production pagination predicates, access filtering, role parity and 70-file pagination. No persistent data is written.
- TypeScript and scoped ESLint pass. `git diff --check` passes.

Authenticated write/recovery acceptance remains a release check, not a claimed live verification: use a disposable project for failed note saves, lost editing leases, actual upload retry, version restore and Trash/permanent-deletion scenarios. No user files were uploaded, edited, restored or deleted during this pass. No deployment or GitHub mutation was performed. Optional cross-device shortcuts, content indexing and specialist preview integrations remain separate capabilities; this implementation does not pretend browser-local shortcuts provide account-wide sync.
