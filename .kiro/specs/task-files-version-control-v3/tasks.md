# Implementation Plan: Task-Files Version Control V3 (Phase 2)

## Overview

Convert the task↔files↔versions surface to full V3 alignment. This plan follows the dependency order: Thread 0 (Foundation) → Thread 1 (Picker) → Thread 2 (Reverse-links) → Thread 3 (Versioning) → Thread 4 (Sprint/Telemetry) → Thread 5 (Cleanup). Two independent bug fixes (sidebar reopen, editor theme) have no thread dependencies and can execute early.

Key decisions:
- All hooks are standalone (no `taskId` coupling)
- Single Project_Channel multiplexes realtime for links + versions
- V3AttachmentPicker reuses `FilesTabSidebar` in navigate-only mode
- V2 cleanup only after all threads verified

## Tasks

- [x] 1. Thread 0 — Foundation (hooks, realtime, bug fixes)
  - [x] 1.1 Implement `useFileVersions` hook
    - Create `src/hooks/useFileVersions.ts`
    - Accept `(projectId: string, nodeId: string)` — no `taskId` parameter
    - Expose `listVersions()` returning `FileVersion[]` sorted by `versionNumber` descending
    - Expose `saveAsNewVersion(file, options?)` calling `replaceNodeWithNewVersion` with lock-conflict structured error handling
    - Expose `restoreVersion(versionNumber)` that bumps `currentVersion` atomically
    - Return `{ versions, isLoading, error, listVersions, saveAsNewVersion, restoreVersion }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_

  - [x] 1.2 Implement `useTaskLinks` hook
    - Create `src/hooks/useTaskLinks.ts`
    - Accept `(projectId: string, nodeId: string)` as parameters
    - Expose `tasks` array with joined metadata (id, title, status, assignee, annotation)
    - Expose `count`, `link(taskId)`, `unlink(taskId)`, `updateAnnotation(taskId, annotation)`, `isLoading`, `error`, `refresh()`
    - Back with server action `getTaskLinksForNode` (joins `task_node_links` → `tasks` → `profiles`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 1.3 Create `getTaskLinksForNode` server action
    - Create `src/app/actions/files/links.ts`
    - Implement `getTaskLinksForNode(projectId, nodeId)` joining `task_node_links` → `tasks` → `profiles` for assignee
    - Return `LinkedTask[]` matching the interface in design
    - _Requirements: 2.8_

  - [x] 1.4 Implement `subscribeProjectFilesChannel` (Project_Channel)
    - Create `src/lib/realtime/project-files-channel.ts`
    - Accept `ProjectFilesChannelOptions` with callbacks for task-link and file-version events
    - Multiplex two Supabase realtime bindings: `task_node_links` (filtered by project) and `file_versions` (filtered by project)
    - Implement exponential backoff reconnect (800ms start, 10s cap) on `CHANNEL_ERROR` / `TIMED_OUT`
    - Stay within `maxBackgroundChannels: 2` budget
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 1.5 Add `patchNodeVersion` store action
    - Edit `src/stores/files/filesSlice.ts`
    - Add `patchNodeVersion(projectId, nodeId, currentVersion)` that patches `nodesById[nodeId].currentVersion` in place and bumps `treeVersion` by 1
    - Ensure `setTaskLinkCounts` accepts zero values (removes TaskLinkChip on unlink)
    - _Requirements: 3.4, 3.5, 3.7_

  - [x] 1.6 Mount Project_Channel in `FilesTabRoot.tsx`
    - Add `useEffect` in `FilesTabRoot` that calls `subscribeProjectFilesChannel` on mount
    - Wire `onTaskLinkChange` → `setTaskLinkCounts`, `onFileVersionChange` → `patchNodeVersion`
    - Cleanup: unsubscribe on unmount or navigation away from Files tab
    - _Requirements: 3.1, 3.2_

  - [x] 1.7 Add lock check to `replaceNodeWithNewVersion`
    - Modify `src/app/actions/files/versions.ts`
    - Add lock check inside the existing transaction (SELECT from `project_node_locks` WHERE `expires_at > NOW()` AND `locked_by != currentUserId`)
    - Return `{ error: "lock_conflict", lockedBy: { userId, displayName, lockedAt } }` if locked
    - _Requirements: 5.1, 5.3_

  - [x] 1.8 Implement sidebar reopen affordance (Bug Fix)
    - Modify `src/components/projects/v2/files-tab/FilesTabMain.tsx`
    - Add `Sidebar_Reopen_Control` as a visible, persistent button on the left edge when sidebar is collapsed
    - Use fixed/sticky positioning so it's always visible regardless of scroll
    - Minimum touch target 44×44 CSS pixels
    - Replace/merge existing `data-testid="files-tab-sidebar-expand"` element, removing `sr-only` class
    - Hide when sidebar is visible
    - On click: expand sidebar to 280px
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

  - [x] 1.9 Fix editor theme to follow app theme (Bug Fix)
    - Modify `src/components/projects/v2/files-tab/file/TextViewer.tsx`
    - Read active theme from existing theme provider
    - Apply dark theme (dark background, light text) when app theme is "dark"
    - Apply light theme (light background, dark text) when app theme is "light"
    - Update theme within 500ms on runtime theme change without page reload
    - Apply fix to both V3 Files tab and task panel editor surfaces
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

  - [x] 1.10 Implement IDB session key migration
    - Modify `src/lib/open-file-sessions.ts` (or equivalent)
    - `findSessionByFilename`: try new key format `${nodeId}` first, fall back to legacy `${nodeId}::${filename}`
    - New writes use only the new key format `${nodeId}`
    - _Requirements: 13.1, 13.2, 13.3, 13.4_


  - [x] 1.11 Wire `useTaskFileMutations` to delegate to `useFileVersions`
    - Modify existing `useTaskFileMutations` hook to internally call `useFileVersions.saveAsNewVersion`
    - Preserve existing task-bound behavior and notification triggers
    - _Requirements: 1.6_

  - [x] 1.12 Implement `file_version_added` notification for taskless version bumps
    - Modify notification emission in `replaceNodeWithNewVersion`
    - When node has zero `task_node_links`: emit `file_version_added` to favoriters + last 5 distinct editors + linked-task participants
    - When node has one or more `task_node_links`: emit existing `task_file_replaced` notification unchanged
    - Include node name, version number, and creator identity in notification
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 2. Checkpoint — Foundation verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Thread 1 — V3 Attachment Picker
  - [x] 3.1 Implement `V3AttachmentPicker` component
    - Create `src/components/projects/v2/files-tab/picker/V3AttachmentPicker.tsx`
    - Render `FilesTabSidebar` tree in `mode="navigate-only"` (disable mutations, context-menu limited to "Reveal" and "Open")
    - Right pane: search results when query non-empty, recent files when query empty
    - Pinned tray at bottom showing selected items as removable chips
    - Removing a chip deselects the item from the selection set
    - Emit `files_tab.picker_opened` telemetry event on mount
    - Record `performance.mark("files-tab:picker-interactive")` on first interactive state
    - Must NOT import `FileExplorer` or `ExplorerShell`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 16.1, 17.3_

  - [x] 3.2 Implement `MultiAttachmentPicker` wrapper
    - Create `src/components/projects/v2/files-tab/picker/MultiAttachmentPicker.tsx`
    - Accept `onConfirm(nodes: ProjectNode[])` callback
    - Integrate into `CreateTaskModal` for multi-file selection during task creation
    - _Requirements: 6.5_

  - [x] 3.3 Implement `SingleAttachmentPicker` wrapper
    - Create `src/components/projects/v2/files-tab/picker/SingleAttachmentPicker.tsx`
    - Call `linkNodeToTask` immediately upon selection
    - Integrate into `TaskDetailTabs/FilesTab` for in-panel attachment
    - _Requirements: 6.6_

  - [x] 3.4 Implement `TaskSearchPicker` component
    - Create `src/components/projects/v2/files-tab/picker/TaskSearchPicker.tsx`
    - Project-scoped task search dialog listing tasks the user can link to
    - Accept `onSelect(taskId)` callback
    - _Requirements: 9.3, 9.4_

  - [x] 3.5 Delete legacy V2 picker components
    - Delete `TaskAttachmentPicker.tsx` and `TaskFileAttachPickerDialog.tsx`
    - Verify zero remaining import references before deletion
    - _Requirements: 6.8_

  - [x] 3.6 Verify Tasks tab non-regression after picker swap
    - Run existing Tasks tab E2E test suite
    - Confirm task creation, task file attachment, and task detail panel work unchanged
    - _Requirements: 23.1, 23.2, 23.3_

- [x] 4. Checkpoint — Picker verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Thread 2 — Reverse-Link Visibility
  - [x] 5.1 Implement `TaskLinkChip` component
    - Create `src/components/projects/v2/files-tab/TaskLinkChip.tsx`
    - Accept `{ count, onClick, className? }`
    - Render badge with count; emit `files_tab.task_link_chip_clicked` telemetry on click
    - _Requirements: 7.1, 7.2, 16.2_

  - [x] 5.2 Integrate `TaskLinkChip` into `FolderListRow`, `FileTreeRow`, and `MetadataStrip`
    - Render TaskLinkChip when node has ≥1 task links; hide when zero
    - On click: open popover listing linked tasks with title and status
    - Update count within 500ms of realtime event via Project_Channel
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 5.3 Implement `LinkedTasksPanel` component
    - Create `src/components/projects/v2/files-tab/file/LinkedTasksPanel.tsx`
    - Collapsible right-side drawer on FileView
    - List all linked tasks showing title, status, assignee, annotation
    - Click task row → open task panel with `initialTab="files"`
    - Role_Owner/Role_Member: inline annotation editor via `updateAnnotation`
    - Role_Viewer: read-only, no annotation editor or mutation affordances
    - Record `performance.mark("files-tab:linked-tasks-panel-interactive")` on first interactive state
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 17.1, 24.3_

  - [x] 5.4 Add LinkedTasksPanel toggle to `FileActionsBar`
    - Add toggle button in FileActionsBar that opens/closes LinkedTasksPanel
    - Toggle visible to all roles
    - _Requirements: 8.1, 8.6_

  - [x] 5.5 Implement "Attach to task…" action in `FileActionsBar`
    - Add "Attach to task…" button (hidden for Role_Viewer)
    - On click: open `TaskSearchPicker`
    - On task selection: call `linkNodeToTask(taskId, nodeId)` and close picker
    - On failure: show error toast, keep picker open for retry
    - On success: TaskLinkChip updates to reflect new count
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 24.1_

- [x] 6. Checkpoint — Reverse-links verified
  - Ensure all tests pass, ask the user if questions arise.


- [x] 7. Thread 3 — Versioning End-to-End in V3 Surface
  - [x] 7.1 Add "View history" button to `MetadataStrip`
    - Render "View history" button adjacent to Version_Pill
    - Visible to all roles (Owner, Member, Viewer)
    - On click: open `FileVersionHistoryPanel` as side drawer
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 7.2 Implement `FileVersionHistoryPanel`
    - Create `src/components/projects/v2/files-tab/file/FileVersionHistoryPanel.tsx`
    - Display all File_Version records ordered by `versionNumber` descending
    - Role_Owner/Role_Member: render "Restore" action on each historical version row
    - Role_Viewer: no "Restore" action visible
    - On "Restore" click: call `useFileVersions.restoreVersion(versionNumber)`, update MetadataStrip
    - Soft-deleted node (`deletedAt` not null): read-only mode, "This file is in the trash" banner, Restore disabled for all roles
    - Record `performance.mark("files-tab:version-history-interactive")` on first interactive state
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 14.1, 14.2, 14.3, 17.2, 24.2_

  - [x] 7.3 Add "Replace…" button to `FileActionsBar`
    - Render "Replace…" button (hidden for Role_Viewer)
    - On click: open native file picker for single file selection
    - On file selected: call `useFileVersions.saveAsNewVersion(file)`
    - On lock conflict: display "Locked by {displayName}" indicator, disable Replace button
    - On success: MetadataStrip updates with new version number and metadata
    - Emit `files_tab.version_replaced` telemetry with `source: "files_tab"`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 5.2, 16.3, 24.1_

  - [x] 7.4 Implement drop-zone on `FileView`
    - Add drop-zone overlay on FileView when single file dragged over (Role_Owner/Role_Member only)
    - Role_Viewer: no drop-zone, no drops accepted
    - Single file drop: call `useFileVersions.saveAsNewVersion` with hash-check and re-upload prompt
    - Hash match: prompt "File is identical — re-upload anyway?"
    - Multi-file drop: ignore drop, show toast "Only single-file drops accepted"
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 24.4_

  - [x] 7.5 Emit `files_tab.version_restored` telemetry on restore
    - Wire telemetry event in `FileVersionHistoryPanel` restore flow
    - _Requirements: 16.4_

- [x] 8. Checkpoint — Versioning verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Thread 4 — Sprint Timeline Integration & Telemetry
  - [x] 9.1 Render version events as inline sub-rows in Sprint_Timeline
    - When `file_version_added` event occurs for a file linked to a task in current sprint: render as inline sub-row beneath the "linked file" row
    - Do NOT render as new top-level rows
    - Drop events for files not linked to any task in current sprint
    - Sprint header counters count linked files only, not individual versions
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [x] 9.2 Update `SprintDetailDrawer` file fetch to include `currentVersion`
    - Ensure Version_Pill in drawer reflects latest version
    - _Requirements: 15.5_

  - [x] 9.3 Wire all remaining telemetry events
    - Verify `files_tab.picker_opened` fires on V3AttachmentPicker open
    - Verify `files_tab.task_link_chip_clicked` fires on TaskLinkChip click
    - Verify `files_tab.version_replaced` includes correct `source` field ("task_panel" vs "files_tab")
    - Verify `files_tab.version_restored` fires on restore
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [x] 9.4 Wire all performance marks
    - Verify `performance.mark("files-tab:linked-tasks-panel-interactive")` fires
    - Verify `performance.mark("files-tab:version-history-interactive")` fires
    - Verify `performance.mark("files-tab:picker-interactive")` fires
    - _Requirements: 17.1, 17.2, 17.3_

- [x] 10. Checkpoint — Sprint/Telemetry verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Thread 5 — V2 Cleanup (depends on ALL prior threads)
  - [x] 11.1 Confirm zero import references to V2 explorer modules
    - Run import-graph audit for: `ExplorerShell`, `FileExplorer.tsx`, `MultiFileDiffDialog`, `MultiSelectActionsBar`, `OutlinePanel`, `SourceControlPanel`, `ExplorerCommandPalette`, `ExplorerInsightsHost`, `ExplorerOperationsHost`, `ExplorerSearch`, `ExplorerToolbarHost`, `ExplorerBatchOps`, `ExplorerQuickOpen`, `FileGridItem`
    - Migrate any remaining callers to V3 equivalents before deletion
    - _Requirements: 20.1, 20.2, 20.3_

  - [x] 11.2 Delete legacy V2 explorer modules
    - Delete all modules confirmed to have zero callers in 11.1
    - _Requirements: 20.1, 20.2_

  - [x] 11.3 Remove legacy workspace store methods
    - Remove: `openTab`, `saveCurrentView`, `applySavedView`, `setGitSyncStatus`, `requestScrollTo`, and any other V2-only methods identified in import-graph audit
    - Migrate or remove any remaining callers first
    - Verify workspace store passes all existing unit/integration tests for non-removed functionality
    - _Requirements: 21.1, 21.2, 21.3_

  - [x] 11.4 Delete `NEXT_PUBLIC_FILES_TAB_V3` feature flag
    - Remove env variable from all configuration files
    - Remove all conditional branches referencing the flag
    - System renders V3 Files tab unconditionally
    - _Requirements: 22.1, 22.2_

  - [x] 11.5 Run final import-graph audit
    - Confirm zero imports from deleted V2 modules
    - Confirm zero references to deleted feature flag
    - Resolve any residual references found
    - _Requirements: 22.3, 22.4_

  - [x] 11.6 Create final checkpoint commit
    - Commit all cleanup changes after verification
    - _Requirements: 22.5_

- [x] 12. Final checkpoint — Cleanup verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Property-Based Tests (numRuns=100)
  - [x] 13.1 Write property test — Picker Selection Round-Trip (Property 1)
    - File: `tests/unit/files-tab/properties/picker-selection-roundtrip.test.ts`
    - **Property 1: Picker Selection Round-Trip**
    - **Validates: Requirements 6.5**
    - Generator: arbitrary sets of ProjectNode objects (varying sizes 0..20)
    - Invariant: `confirm(select(nodes)) |> reopen |> getChips == nodes`
    - `fc.assert(..., { numRuns: 100 })`

  - [x] 13.2 Write property test — Reverse-Link Consistency (Property 2)
    - File: `tests/unit/files-tab/properties/reverse-link-consistency.test.ts`
    - **Property 2: Reverse-Link Consistency**
    - **Validates: Requirements 7.5, 2.9**
    - Generator: arbitrary node with 0..50 task links
    - Invariant: `TaskLinkChip.count == useTaskLinks(projectId, nodeId).tasks.length`
    - `fc.assert(..., { numRuns: 100 })`

  - [x] 13.3 Write property test — Version Count Invariant (Property 3)
    - File: `tests/unit/files-tab/properties/version-count-invariant.test.ts`
    - **Property 3: Version Count Invariant**
    - **Validates: Requirements 1.7**
    - Generator: arbitrary node with `currentVersion` 1..100, version array of matching or greater length
    - Invariant: `listVersions(projectId, nodeId).length >= node.currentVersion`
    - `fc.assert(..., { numRuns: 100 })`

  - [x] 13.4 Write property test — Restore Monotonicity (Property 4)
    - File: `tests/unit/files-tab/properties/restore-monotonicity.test.ts`
    - **Property 4: Restore Monotonicity**
    - **Validates: Requirements 10.6**
    - Generator: arbitrary sequence of `restoreVersion` calls with valid version numbers
    - Invariant: `restoreVersion(v) => node.currentVersion' > node.currentVersion`
    - `fc.assert(..., { numRuns: 100 })`

  - [x] 13.5 Write property test — TaskLinkCounts Realtime Convergence (Property 5)
    - File: `tests/unit/files-tab/properties/task-link-counts-convergence.test.ts`
    - **Property 5: TaskLinkCounts Realtime Convergence**
    - **Validates: Requirements 3.4**
    - Generator: arbitrary sequence of link/unlink mutations
    - Invariant: `eventually(store.taskLinkCounts[nodeId] == server.getTaskLinkCounts(nodeId))`
    - `fc.assert(..., { numRuns: 100 })`

  - [x] 13.6 Write property test — IDB Session Key Round-Trip (Property 6)
    - File: `tests/unit/files-tab/properties/idb-session-key-roundtrip.test.ts`
    - **Property 6: IDB Session Key Round-Trip**
    - **Validates: Requirements 13.4**
    - Generator: arbitrary `(nodeId, filename)` pairs with valid characters
    - Invariant: `write(nodeId, session) |> findSessionByNodeId(nodeId) == session`
    - `fc.assert(..., { numRuns: 100 })`

- [x] 14. E2E Tests (each calls `recordAudit`)
  - [x] 14.1 E2E — V3 picker: create-task with multi-select
    - File: `tests/e2e/files-tab/picker-multi-select.spec.ts`
    - Open CreateTaskModal, use MultiAttachmentPicker to select multiple files, confirm, verify attachments
    - Call `recordAudit("picker-multi-select", result)`
    - _Requirements: 6.5, 25.1_

  - [x] 14.2 E2E — V3 picker: in-panel attach
    - File: `tests/e2e/files-tab/picker-in-panel.spec.ts`
    - Open task detail, use SingleAttachmentPicker to attach file, verify link created
    - Call `recordAudit("picker-in-panel", result)`
    - _Requirements: 6.6, 25.1_

  - [x] 14.3 E2E — V3 picker: search → attach → recents
    - File: `tests/e2e/files-tab/picker-search-recents.spec.ts`
    - Open picker, search for file, attach, reopen picker, verify file appears in recents
    - Call `recordAudit("picker-search-recents", result)`
    - _Requirements: 6.2, 25.1_

  - [x] 14.4 E2E — TaskLinkChip: link file → chip appears → click → popover
    - File: `tests/e2e/files-tab/task-link-chip.spec.ts`
    - Link a file to a task, navigate to Files tab, verify chip appears, click chip, verify popover
    - Call `recordAudit("task-link-chip", result)`
    - _Requirements: 7.1, 7.3, 25.1_

  - [x] 14.5 E2E — LinkedTasksPanel: open → list tasks → click task → panel opens
    - File: `tests/e2e/files-tab/linked-tasks-panel.spec.ts`
    - Open file with linked tasks, toggle LinkedTasksPanel, verify task list, click task row, verify task panel opens
    - Call `recordAudit("linked-tasks-panel", result)`
    - _Requirements: 8.1, 8.2, 8.3, 25.1_

  - [x] 14.6 E2E — Version replace from Files tab → pill updates → history shows new version
    - File: `tests/e2e/files-tab/version-replace.spec.ts`
    - Open file, click Replace, select file, verify version pill updates, open history, verify new version row
    - Call `recordAudit("version-replace", result)`
    - _Requirements: 11.4, 11.6, 25.1_

  - [x] 14.7 E2E — Version restore from Files tab → new version row → pill updates
    - File: `tests/e2e/files-tab/version-restore.spec.ts`
    - Open file history, click Restore on historical version, verify new version row created, verify pill updates
    - Call `recordAudit("version-restore", result)`
    - _Requirements: 10.6, 25.1_

  - [x] 14.8 E2E — Drop-zone: single file drop → version bump
    - File: `tests/e2e/files-tab/drop-zone-single.spec.ts`
    - Open file, drag single file onto FileView, verify version bumps
    - Call `recordAudit("drop-zone-single", result)`
    - _Requirements: 12.3, 25.1_

  - [x] 14.9 E2E — Drop-zone: multi-file drop → toast rejection
    - File: `tests/e2e/files-tab/drop-zone-multi.spec.ts`
    - Open file, drag multiple files onto FileView, verify toast "Only single-file drops accepted"
    - Call `recordAudit("drop-zone-multi", result)`
    - _Requirements: 12.5, 25.1_

  - [x] 14.10 E2E — Viewer role: no Replace/Attach/Restore visible
    - File: `tests/e2e/files-tab/viewer-role-gates.spec.ts`
    - Log in as Viewer, navigate to file, verify Replace/Attach/Restore buttons are not rendered
    - Call `recordAudit("viewer-role-gates", result)`
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 25.1_

  - [x] 14.11 E2E — Sidebar reopen: collapse → reopen control visible → click → sidebar returns
    - File: `tests/e2e/files-tab/sidebar-reopen.spec.ts`
    - Collapse sidebar, verify reopen control appears, click it, verify sidebar expands to 280px
    - Call `recordAudit("sidebar-reopen", result)`
    - _Requirements: 18.1, 18.3, 18.5, 25.1_

  - [x] 14.12 E2E — Editor theme: dark mode → editor uses dark theme
    - File: `tests/e2e/files-tab/editor-theme.spec.ts`
    - Set app to dark mode, open text file in edit mode, verify editor has dark background
    - Call `recordAudit("editor-theme", result)`
    - _Requirements: 19.2, 25.1_

  - [x] 14.13 E2E — Sprint timeline: version event renders as sub-row
    - File: `tests/e2e/files-tab/sprint-timeline-version.spec.ts`
    - Create version for file linked to sprint task, navigate to sprint timeline, verify sub-row renders
    - Call `recordAudit("sprint-timeline-version", result)`
    - _Requirements: 15.1, 15.2, 25.1_

- [x] 15. Final checkpoint — All tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each thread
- Property tests validate universal correctness properties from the design document (numRuns=100)
- E2E tests all call `recordAudit` per Requirement 25
- Thread 5 (cleanup) depends on ALL prior threads being complete
- Bug fixes (1.8 sidebar reopen, 1.9 editor theme) have no dependencies on other threads and can execute early
- The V3AttachmentPicker must NOT import legacy `FileExplorer` or `ExplorerShell`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.8", "1.9", "1.10"] },
    { "id": 1, "tasks": ["1.4", "1.5", "1.7", "1.11", "1.12"] },
    { "id": 2, "tasks": ["1.6"] },
    { "id": 3, "tasks": ["3.1", "3.4"] },
    { "id": 4, "tasks": ["3.2", "3.3", "3.5"] },
    { "id": 5, "tasks": ["3.6"] },
    { "id": 6, "tasks": ["5.1", "5.3"] },
    { "id": 7, "tasks": ["5.2", "5.4", "5.5"] },
    { "id": 8, "tasks": ["7.1", "7.3", "7.4"] },
    { "id": 9, "tasks": ["7.2", "7.5"] },
    { "id": 10, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
    { "id": 11, "tasks": ["11.1"] },
    { "id": 12, "tasks": ["11.2", "11.3"] },
    { "id": 13, "tasks": ["11.4"] },
    { "id": 14, "tasks": ["11.5"] },
    { "id": 15, "tasks": ["11.6"] },
    { "id": 16, "tasks": ["13.1", "13.2", "13.3", "13.4", "13.5", "13.6"] },
    { "id": 17, "tasks": ["14.1", "14.2", "14.3", "14.4", "14.5", "14.6", "14.7", "14.8", "14.9", "14.10", "14.11", "14.12", "14.13"] }
  ]
}
```
