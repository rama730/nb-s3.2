# Requirements Document

## Introduction

This spec covers Phase 2 of the V3 Files tab rollout ("task-files-version-control-v3"). Phase 1 ("files-tab-github-redesign") shipped the new V3 Files tab UI behind `NEXT_PUBLIC_FILES_TAB_V3=1`. The legacy V2 explorer (`ExplorerShell`, `FileExplorer`) survives only because the Tasks tab still depends on it.

Phase 2 delivers end-to-end V3 alignment of the task↔files↔versions surface across five threads: shared foundation hooks and realtime, a V3 attachment picker replacing both V2 pickers, reverse-link visibility from files back to tasks, versioning end-to-end in the V3 surface, sprint integration and telemetry, and final cleanup of all V2 remnants. Two bug fixes (sidebar reopen affordance, editor theme mismatch) are folded in.

## Glossary

- **Files_Tab**: The V3 Files tab rendered on the project detail page. Subject of Phase 1 spec; extended by this spec.
- **Project_Node**: A row in the `projectNodes` table representing a file or folder. Has `id`, `parentId`, `name`, `type`, `size`, `updatedAt`, `updatedBy`, `currentVersion`, `deletedAt`.
- **Node**: Shorthand for Project_Node when context is unambiguous.
- **Task_Node_Link**: A row in the `taskNodeLinks` table associating a task with a Project_Node. Has `taskId`, `nodeId`, `annotation`.
- **File_Version**: A row in the `fileVersions` table representing one historical version of a file. Has `id`, `nodeId`, `versionNumber`, `s3Key`, `size`, `mimeType`, `contentHash`, `createdAt`, `createdBy`, `comment`.
- **Role_Owner**: A user who owns the project. Full read/write access.
- **Role_Member**: A user who is a member of the project. Full read/write access.
- **Role_Viewer**: A user with read-only access (including unauthenticated viewers of a public project). Cannot perform mutations.
- **V3AttachmentPicker**: The new unified file picker component replacing both V2 pickers (`TaskAttachmentPicker` and `TaskFileAttachPickerDialog`).
- **FileVersionHistoryPanel**: The shared version-history drawer component, lifted from `tasks/components/FileVersionHistoryDrawer` to `files-tab/file/FileVersionHistoryPanel.tsx`.
- **LinkedTasksPanel**: A collapsible right-side drawer on `FileView` showing tasks linked to the currently viewed file.
- **TaskLinkChip**: A small badge rendered on file/folder rows indicating the count of linked tasks.
- **useFileVersions**: A hook extracted from `useTaskFileMutations` providing `listVersions`, `saveAsNewVersion`, `restoreVersion` without requiring a `taskId`.
- **useTaskLinks**: A hook providing `{ tasks, count, link, unlink, updateAnnotation, isLoading }` for a given `(projectId, nodeId)`.
- **Project_Channel**: A project-scoped Supabase realtime channel multiplexing `task_node_links` and `file_versions` bindings. Lazy-mounted when Files tab is active.
- **Lock_Conflict**: A structured error returned by `replaceNodeWithNewVersion` when the target node is locked by another user.
- **Sprint_Timeline**: The timeline view within a sprint that renders events chronologically.
- **MetadataStrip**: The header block inside the Single_File_View displaying file metadata (name, size, version, timestamps, MIME type).
- **FileActionsBar**: The action toolbar in the Single_File_View containing Raw, Edit, Download, and (new) Replace and Attach-to-task buttons.
- **Sidebar_Reopen_Control**: A visible, persistent affordance on the left edge of `FilesTabMain` allowing users to reopen a collapsed sidebar.
- **IDB_Session_Key**: The IndexedDB key format used by `open-file-sessions.ts` to track editing sessions.

## Requirements

### Requirement 1: Shared Hook — useFileVersions

**User Story:** As a developer, I want a standalone hook for file version operations that does not require a taskId, so that both the Files tab and the Task panel can manage versions through a single API.

#### Acceptance Criteria

1. THE useFileVersions hook SHALL accept `(projectId: string, nodeId: string)` as parameters and SHALL NOT require a `taskId` parameter.
2. THE useFileVersions hook SHALL expose `listVersions()` which returns an ordered array of File_Version records for the given node, sorted by `versionNumber` descending.
3. THE useFileVersions hook SHALL expose `saveAsNewVersion(file: File, options?: { comment?: string })` which uploads the file and calls `replaceNodeWithNewVersion`, returning the updated Project_Node and new File_Version on success.
4. THE useFileVersions hook SHALL expose `restoreVersion(versionNumber: number)` which restores the specified version as the current version, bumping `currentVersion` atomically.
5. IF `replaceNodeWithNewVersion` returns a Lock_Conflict error, THEN THE useFileVersions hook SHALL return a structured error containing the lock holder's identity and SHALL NOT throw an unstructured exception.
6. THE existing `useTaskFileMutations` hook SHALL delegate its `saveAsNewVersion` call to `useFileVersions` internally, preserving the existing task-bound behavior and notification triggers.
7. FOR ALL valid File_Version arrays returned by `listVersions`, THE array length SHALL be greater than or equal to the node's `currentVersion` value (version count invariant).

### Requirement 2: Shared Hook — useTaskLinks

**User Story:** As a developer, I want a hook that provides task-link operations for any node without coupling to a specific task panel instance, so that the Files tab can display and manage reverse links.

#### Acceptance Criteria

1. THE useTaskLinks hook SHALL accept `(projectId: string, nodeId: string)` as parameters.
2. THE useTaskLinks hook SHALL expose `tasks` as an array of linked task objects (id, title, status, assignee, annotation) for the given node.
3. THE useTaskLinks hook SHALL expose `count` as the number of tasks linked to the given node.
4. THE useTaskLinks hook SHALL expose `link(taskId: string)` which creates a Task_Node_Link between the given task and node.
5. THE useTaskLinks hook SHALL expose `unlink(taskId: string)` which removes the Task_Node_Link between the given task and node.
6. THE useTaskLinks hook SHALL expose `updateAnnotation(taskId: string, annotation: string)` which updates the annotation field on the Task_Node_Link.
7. THE useTaskLinks hook SHALL expose `isLoading` as a boolean indicating whether the initial fetch is in progress.
8. THE useTaskLinks hook SHALL be backed by a new server action `getTaskLinksForNode(projectId, nodeId)` that returns all Task_Node_Links for the given node with joined task metadata.
9. FOR ALL nodes where `useTaskLinks` returns `count = N`, THE `tasks` array SHALL contain exactly N entries (count consistency property).

### Requirement 3: Project-Scoped Realtime Channel

**User Story:** As a user viewing the Files tab, I want live updates when files are versioned or linked to tasks, so that I see fresh data without manual refresh.

#### Acceptance Criteria

1. WHEN the Files_Tab becomes active, THE system SHALL lazy-mount a single Project_Channel for the current project that multiplexes two Supabase realtime bindings: `task_node_links` (filtered by project) and `file_versions` (filtered by project).
2. WHEN the Files_Tab is unmounted or the user navigates away from the Files tab, THE system SHALL unsubscribe and remove the Project_Channel.
3. THE Project_Channel SHALL stay within the `maxBackgroundChannels: 2` budget per project page, counting alongside any existing task-resource channel.
4. WHEN a `task_node_links` INSERT or DELETE event arrives on the Project_Channel, THE system SHALL invoke `setTaskLinkCounts` on the affected node to update the rendered TaskLinkChip count.
5. WHEN a `file_versions` INSERT event arrives on the Project_Channel, THE system SHALL invoke `patchNodeVersion(projectId, nodeId, newVersion)` to update the rendered Version_Pill and MetadataStrip.
6. IF the Project_Channel enters a `CHANNEL_ERROR` or `TIMED_OUT` state, THEN THE system SHALL attempt reconnection with exponential backoff (starting at 800ms, capped at 10s), matching the pattern used by the existing task-resource channel.
7. THE `setTaskLinkCounts` store action SHALL accept a count of zero to represent an unlink, removing the TaskLinkChip when no links remain.

### Requirement 4: Notifications for Taskless Version Bumps

**User Story:** As a file favoriter or recent editor, I want to be notified when someone adds a new version to a file I care about, even if the file is not linked to any task.

#### Acceptance Criteria

1. WHEN a new File_Version is created for a node that has zero Task_Node_Links, THE system SHALL emit a `file_version_added` notification.
2. THE `file_version_added` notification audience SHALL include: all users who have favorited the node, plus the last 5 distinct editors of the node (by `updatedBy` on File_Version records), plus participants of any tasks linked to the node.
3. WHEN a new File_Version is created for a node that has one or more Task_Node_Links, THE system SHALL emit the existing `task_file_replaced` notification with its existing audience logic unchanged.
4. THE `file_version_added` notification SHALL include the node name, version number, and the identity of the user who created the version.

### Requirement 5: Lock-Aware Version Write

**User Story:** As a user attempting to replace a file, I want to see who holds the lock if the file is locked, so that I understand why my action was blocked.

#### Acceptance Criteria

1. IF `replaceNodeWithNewVersion` is called on a node that is locked by another user, THEN THE server action SHALL return a structured error object containing `{ error: "lock_conflict", lockedBy: { userId, displayName, lockedAt } }` and SHALL NOT mutate the node or create a File_Version.
2. WHEN the UI receives a Lock_Conflict error from `useFileVersions.saveAsNewVersion`, THE FileActionsBar or FileVersionHistoryPanel SHALL display a non-modal indicator stating "Locked by {displayName}" with the lock timestamp.
3. THE lock check SHALL occur inside the same database transaction as the version write to prevent TOCTOU races.

### Requirement 6: V3 Attachment Picker

**User Story:** As a project member creating or editing a task, I want a modern file picker that reuses the V3 sidebar tree, so that attaching files feels consistent with the Files tab experience.

#### Acceptance Criteria

1. THE V3AttachmentPicker SHALL render the `FilesTabSidebar` tree in a `mode="navigate-only"` configuration that disables mutations and context-menu actions beyond "Reveal" and "Open".
2. THE V3AttachmentPicker SHALL render a right pane that displays search results when the search query is non-empty, and displays recent files when the search query is empty.
3. THE V3AttachmentPicker SHALL render a pinned tray at the bottom showing currently selected items as removable chips.
4. WHEN the user removes a chip from the pinned tray, THE V3AttachmentPicker SHALL deselect that item from the selection set.
5. THE `MultiAttachmentPicker` wrapper SHALL accept an `onConfirm(nodes: ProjectNode[])` callback and SHALL be used in `CreateTaskModal` for multi-file selection during task creation.
6. THE `SingleAttachmentPicker` wrapper SHALL call `linkNodeToTask` immediately upon selection and SHALL be used in `TaskDetailTabs/FilesTab` for in-panel attachment.
7. WHEN the V3AttachmentPicker is mounted, THE system SHALL NOT import or render `FileExplorer` or `ExplorerShell`.
8. AFTER the V3AttachmentPicker is integrated, THE system SHALL delete `TaskAttachmentPicker.tsx` and `TaskFileAttachPickerDialog.tsx`.

### Requirement 7: Reverse-Link Visibility — TaskLinkChip

**User Story:** As a user browsing files, I want to see which files are linked to tasks without opening each file, so that I can understand task-file relationships at a glance.

#### Acceptance Criteria

1. WHILE a Project_Node has one or more Task_Node_Links, THE `FolderListRow`, `FileTreeRow`, and `MetadataStrip` SHALL render a TaskLinkChip displaying the count of linked tasks.
2. WHILE a Project_Node has zero Task_Node_Links, THE `FolderListRow`, `FileTreeRow`, and `MetadataStrip` SHALL NOT render a TaskLinkChip.
3. WHEN the user clicks a TaskLinkChip, THE system SHALL open a popover listing the linked tasks with their title and status.
4. WHEN the task link count for a node changes via the Project_Channel, THE TaskLinkChip SHALL update its displayed count within 500 milliseconds of the realtime event.
5. FOR ALL nodes, THE TaskLinkChip count SHALL equal the length of the `tasks` array returned by `useTaskLinks` for that node (reverse-link consistency property).

### Requirement 8: Reverse-Link Visibility — LinkedTasksPanel

**User Story:** As a user viewing a file, I want to see all tasks linked to it in a side panel with status, assignee, and annotation, so that I can understand the file's task context.

#### Acceptance Criteria

1. THE FileView SHALL render a toggle button in the FileActionsBar that opens and closes the LinkedTasksPanel as a collapsible right-side drawer.
2. WHILE the LinkedTasksPanel is open, THE panel SHALL list all tasks linked to the current file, showing each task's title, status, assignee, and annotation.
3. WHEN the user clicks a task row in the LinkedTasksPanel, THE system SHALL open the task panel with `initialTab="files"`.
4. WHERE the current user has role Role_Owner or Role_Member, THE LinkedTasksPanel SHALL render an inline annotation editor on each task row allowing the user to set or update the annotation (e.g., "for review") via `updateAnnotation`.
5. WHERE the current user has role Role_Viewer, THE LinkedTasksPanel SHALL render task rows as read-only without the annotation editor or any mutation affordances.
6. THE LinkedTasksPanel toggle button SHALL be visible to all roles (Role_Owner, Role_Member, Role_Viewer).

### Requirement 9: Symmetric Attach — "Attach to task" from Files Tab

**User Story:** As a project member viewing a file, I want to attach it to a task directly from the Files tab, so that I do not have to navigate to the task panel first.

#### Acceptance Criteria

1. WHERE the current user has role Role_Owner or Role_Member, THE FileActionsBar SHALL render an "Attach to task…" action button.
2. WHERE the current user has role Role_Viewer, THE FileActionsBar SHALL NOT render the "Attach to task…" action button.
3. WHEN the user activates "Attach to task…", THE system SHALL open a project-scoped task picker dialog listing tasks the user can link to.
4. WHEN the user selects a task in the task picker, THE system SHALL call `linkNodeToTask(taskId, nodeId)` and close the picker.
5. IF `linkNodeToTask` fails, THEN THE system SHALL display an error toast and SHALL NOT close the picker.
6. WHEN a link is successfully created via "Attach to task…", THE TaskLinkChip on the current file SHALL update to reflect the new count.

### Requirement 10: Versioning — "View history" in MetadataStrip

**User Story:** As a user viewing a file, I want to open the version history from the metadata strip, so that I can see all past versions and optionally restore one.

#### Acceptance Criteria

1. THE MetadataStrip SHALL render a "View history" button adjacent to the Version_Pill.
2. WHEN the user activates "View history", THE system SHALL open the FileVersionHistoryPanel as a side drawer displaying all File_Version records for the current node, ordered by `versionNumber` descending.
3. THE "View history" button SHALL be visible to all roles (Role_Owner, Role_Member, Role_Viewer).
4. WHERE the current user has role Role_Owner or Role_Member, THE FileVersionHistoryPanel SHALL render a "Restore" action on each historical version row.
5. WHERE the current user has role Role_Viewer, THE FileVersionHistoryPanel SHALL NOT render the "Restore" action.
6. WHEN the user activates "Restore" on a version, THE system SHALL call `useFileVersions.restoreVersion(versionNumber)` and update the MetadataStrip to reflect the restored version.
7. IF the node is soft-deleted (`deletedAt` is not null), THEN THE FileVersionHistoryPanel SHALL display the version history as read-only with a notice "This file is in the trash" and SHALL disable the "Restore" action for all roles.

### Requirement 11: Versioning — "Replace…" in FileActionsBar

**User Story:** As a project member, I want to replace the current file with a new version directly from the file view, so that I can update files without navigating to the task panel.

#### Acceptance Criteria

1. WHERE the current user has role Role_Owner or Role_Member, THE FileActionsBar SHALL render a "Replace…" button.
2. WHERE the current user has role Role_Viewer, THE FileActionsBar SHALL NOT render the "Replace…" button.
3. WHEN the user activates "Replace…", THE system SHALL open a native file picker dialog allowing the user to select a single file.
4. WHEN the user selects a file in the native picker, THE system SHALL call `useFileVersions.saveAsNewVersion` with the selected file.
5. IF the node is locked by another user, THEN THE system SHALL display the Lock_Conflict indicator (per Requirement 5.2) and SHALL NOT proceed with the upload.
6. WHEN `saveAsNewVersion` succeeds, THE MetadataStrip SHALL update to reflect the new version number and file metadata.

### Requirement 12: Versioning — Drop-Zone on FileView

**User Story:** As a project member, I want to drag-and-drop a file onto the open file view to save it as a new version, so that updating a file is as easy as dropping it.

#### Acceptance Criteria

1. WHERE the current user has role Role_Owner or Role_Member, THE FileView SHALL render a drop-zone overlay when a single file is dragged over the view area.
2. WHERE the current user has role Role_Viewer, THE FileView SHALL NOT render a drop-zone overlay and SHALL NOT accept drops.
3. WHEN the user drops a single file onto the FileView drop-zone, THE system SHALL call `useFileVersions.saveAsNewVersion` with the dropped file, using the same hash-check and re-upload prompt logic as the task panel.
4. IF the dropped file's content hash matches the current version's content hash, THEN THE system SHALL prompt the user to confirm the re-upload before proceeding.
5. IF more than one file is dropped, THEN THE system SHALL ignore the drop and display a toast indicating only single-file drops are accepted for version replacement.

### Requirement 13: IDB Session Key Migration

**User Story:** As a developer, I want the IDB session lookup to support both old and new key formats, so that in-progress editing sessions are not lost during the migration.

#### Acceptance Criteria

1. THE `findSessionByFilename` function SHALL attempt to read the IDB session using the new key format `${nodeId}` first.
2. IF no session is found under the new key format, THEN `findSessionByFilename` SHALL fall back to reading the legacy key format `${nodeId}::${filename}`.
3. WHEN writing a new IDB session, THE system SHALL use only the new key format `${nodeId}`.
4. FOR ALL valid nodeId and filename combinations, reading a session written under the new format and reading a session written under the legacy format SHALL return equivalent session data (session key round-trip property).

### Requirement 14: Soft-Deleted File Behaviour in Version History

**User Story:** As a user, I want to view the version history of a trashed file but not restore versions, so that I can audit history without accidentally modifying deleted content.

#### Acceptance Criteria

1. WHEN the user opens FileVersionHistoryPanel for a node where `deletedAt` is not null, THE panel SHALL display all File_Version records in read-only mode.
2. WHILE viewing a soft-deleted node's version history, THE FileVersionHistoryPanel SHALL display a notice "This file is in the trash" at the top of the panel.
3. WHILE viewing a soft-deleted node's version history, THE "Restore" action SHALL be disabled for all roles including Role_Owner and Role_Member.

### Requirement 15: Sprint Timeline Integration

**User Story:** As a sprint participant, I want version events to appear inline under linked-file rows in the sprint timeline, so that I can track file progress without timeline noise.

#### Acceptance Criteria

1. WHEN a `file_version_added` event occurs for a file linked to a task in the current sprint, THE Sprint_Timeline SHALL render the event as an inline sub-row beneath the existing "linked file" row for that file.
2. THE Sprint_Timeline SHALL NOT render `file_version_added` events as new top-level rows.
3. IF a `file_version_added` event occurs for a file that is not linked to any task in the current sprint, THEN THE Sprint_Timeline SHALL drop the event and SHALL NOT render it.
4. THE sprint header counters SHALL count linked files only and SHALL NOT count individual versions.
5. THE `SprintDetailDrawer` file fetch SHALL include `currentVersion` so that the Version_Pill rendered in the drawer reflects the latest version.

### Requirement 16: Telemetry Events

**User Story:** As a product team member, I want telemetry for key V3 interactions, so that I can measure adoption and identify friction points.

#### Acceptance Criteria

1. WHEN the V3AttachmentPicker is opened, THE system SHALL emit a `files_tab.picker_opened` telemetry event.
2. WHEN the user clicks a TaskLinkChip, THE system SHALL emit a `files_tab.task_link_chip_clicked` telemetry event.
3. WHEN a file version is replaced, THE system SHALL emit a `files_tab.version_replaced` telemetry event with a `source` field indicating `"task_panel"` or `"files_tab"`.
4. WHEN a file version is restored, THE system SHALL emit a `files_tab.version_restored` telemetry event.

### Requirement 17: Performance Marks

**User Story:** As a developer, I want performance marks on key interactive milestones, so that I can measure and optimize time-to-interactive for new panels.

#### Acceptance Criteria

1. WHEN the LinkedTasksPanel reaches its first interactive state, THE system SHALL record a `performance.mark("files-tab:linked-tasks-panel-interactive")`.
2. WHEN the FileVersionHistoryPanel reaches its first interactive state, THE system SHALL record a `performance.mark("files-tab:version-history-interactive")`.
3. WHEN the V3AttachmentPicker reaches its first interactive state, THE system SHALL record a `performance.mark("files-tab:picker-interactive")`.

### Requirement 18: Bug Fix — Sidebar Reopen Affordance

**User Story:** As a user who collapsed the sidebar, I want a visible control to reopen it, so that I am never stuck without access to the tree navigation.

#### Acceptance Criteria

1. WHILE the Sidebar_Tree is collapsed, THE `FilesTabMain` SHALL render a Sidebar_Reopen_Control as a visible, persistent button on the left edge of the main area.
2. THE Sidebar_Reopen_Control SHALL be positioned so it is always visible regardless of scroll position (fixed or sticky positioning).
3. WHEN the user activates the Sidebar_Reopen_Control, THE Files_Tab SHALL expand the Sidebar_Tree to its fixed 280px width.
4. THE Sidebar_Reopen_Control SHALL have a minimum touch target of 44×44 CSS pixels for accessibility compliance.
5. WHILE the Sidebar_Tree is visible, THE Sidebar_Reopen_Control SHALL NOT be rendered.
6. THE existing `data-testid="files-tab-sidebar-expand"` element SHALL be replaced by or merged into the Sidebar_Reopen_Control, removing the `sr-only` class so it becomes visually apparent.

### Requirement 19: Bug Fix — Editor Theme Follows App Theme

**User Story:** As a user in dark mode, I want the text editor to match my app theme, so that I do not see a jarring light editor in a dark interface.

#### Acceptance Criteria

1. THE TextViewer component and any Monaco or CodeMirror editor surface SHALL read the active theme from the existing theme provider (which respects light/dark/system preference).
2. WHEN the app theme is "dark", THE editor SHALL render with a dark theme (dark background, light text).
3. WHEN the app theme is "light", THE editor SHALL render with a light theme (light background, dark text).
4. WHEN the app theme changes at runtime (e.g., system preference toggle), THE editor SHALL update its theme within 500 milliseconds without requiring a page reload.
5. THE theme fix SHALL apply to both the V3 Files tab file view edit mode and any task panel editor surface that renders file content.

### Requirement 20: V2 Cleanup — Delete Legacy Explorer Components

**User Story:** As a developer, I want all unused V2 explorer components removed, so that the codebase is clean and no dead code remains.

#### Acceptance Criteria

1. BEFORE deletion, THE implementation team SHALL confirm zero remaining import references to each of the following modules: `ExplorerShell`, `FileExplorer.tsx` (re-export), `MultiFileDiffDialog`, `MultiSelectActionsBar`, `OutlinePanel`, `SourceControlPanel`, `ExplorerCommandPalette`, `ExplorerInsightsHost`, `ExplorerOperationsHost`, `ExplorerSearch`, `ExplorerToolbarHost`, `ExplorerBatchOps`, `ExplorerQuickOpen`, `FileGridItem`.
2. WHEN zero callers are confirmed, THE implementation team SHALL delete each module listed in criterion 1.
3. IF any module listed in criterion 1 still has callers, THEN THE implementation team SHALL migrate those callers to V3 equivalents before deletion.

### Requirement 21: V2 Cleanup — Drop Legacy Workspace Store Methods

**User Story:** As a developer, I want legacy workspace store methods removed, so that no code path accidentally uses deprecated state management.

#### Acceptance Criteria

1. THE implementation team SHALL remove the following methods from the workspace store: `openTab`, `saveCurrentView`, `applySavedView`, `setGitSyncStatus`, `requestScrollTo`, and any other methods identified as V2-only during the import-graph audit.
2. IF any remaining caller references a removed method, THEN THE implementation team SHALL migrate or remove that caller before the method is deleted.
3. AFTER deletion, THE workspace store SHALL continue to pass all existing unit and integration tests for non-removed functionality.

### Requirement 22: V2 Cleanup — Delete Feature Flag and Final Audit

**User Story:** As a developer, I want the `NEXT_PUBLIC_FILES_TAB_V3` feature flag removed and a clean import-graph audit run, so that the V3 surface is the only code path.

#### Acceptance Criteria

1. THE implementation team SHALL delete the `NEXT_PUBLIC_FILES_TAB_V3` environment variable from all configuration files and remove all conditional branches that reference it.
2. AFTER flag deletion, THE system SHALL render the V3 Files tab unconditionally without any feature-flag check.
3. THE implementation team SHALL run an import-graph audit confirming zero imports from deleted V2 modules and zero references to the deleted feature flag.
4. IF the import-graph audit finds residual references, THEN THE implementation team SHALL resolve them before the spec is considered complete.
5. THE implementation team SHALL create a final checkpoint commit after all cleanup is verified.

### Requirement 23: Tasks Tab Non-Regression

**User Story:** As a user of the Tasks tab, I want all existing task functionality to continue working after Phase 2 changes, so that the migration does not break my workflow.

#### Acceptance Criteria

1. THE implementation of this spec SHALL NOT alter the observable runtime behavior of the Tasks tab, including task creation, task detail panel, task file attachment, task comments, task subtasks, and task status management.
2. IF a change to a shared module (hook, server action, store, utility) is required, THEN THE change SHALL preserve the public API and observable behavior as consumed by the Tasks tab.
3. AFTER all Phase 2 changes are complete, THE existing Tasks tab E2E test suite SHALL pass without modification (beyond import path updates for relocated shared components).

### Requirement 24: Role-Based Mutation Visibility

**User Story:** As a Role_Viewer, I want mutation controls (Replace, Attach to task, Restore) to be invisible, so that I am never confused by actions I cannot perform.

#### Acceptance Criteria

1. WHERE the current user has role Role_Viewer, THE FileActionsBar SHALL NOT render "Replace…", "Attach to task…", or any other mutation button.
2. WHERE the current user has role Role_Viewer, THE FileVersionHistoryPanel SHALL NOT render "Restore" actions on version rows.
3. WHERE the current user has role Role_Viewer, THE LinkedTasksPanel SHALL NOT render the annotation editor or any link/unlink affordances.
4. WHERE the current user has role Role_Viewer, THE FileView drop-zone SHALL NOT be active and SHALL NOT accept file drops.

### Requirement 25: Audit Recording for E2E Tests

**User Story:** As a QA engineer, I want every new E2E spec to call `recordAudit`, so that test coverage is tracked consistently with Phase 1.

#### Acceptance Criteria

1. EVERY new E2E test file created as part of this spec SHALL import and call `recordAudit` from `tests/e2e/files-tab/audit.ts` at least once per test case.
2. IF an E2E test file does not call `recordAudit`, THEN THE test SHALL be considered non-compliant and SHALL be updated before the spec is marked complete.

## Correctness Properties (for property-based testing)

These properties are called out explicitly so they can be exercised via property-based tests:

- **Picker Selection Round-Trip (Requirement 6)**: For any set of Project_Nodes selected in the V3AttachmentPicker, confirming the selection and re-opening the picker with the same initial selection SHALL display the same set of chips in the pinned tray. Formally: `confirm(select(nodes)) |> reopen |> getChips == nodes`.

- **Reverse-Link Consistency (Requirement 7.5 / Requirement 2.9)**: For any node, the TaskLinkChip count equals the length of the `tasks` array returned by `useTaskLinks`. Formally: `chip.count == useTaskLinks(projectId, nodeId).tasks.length`.

- **Version Count Invariant (Requirement 1.7)**: For all nodes, `listVersions(projectId, nodeId).length >= node.currentVersion`. The version array always contains at least as many entries as the current version number indicates.

- **Restore Monotonicity**: For any sequence of `restoreVersion` calls, the resulting `currentVersion` on the node is strictly greater than the `currentVersion` before the restore. Formally: `restoreVersion(v) => node.currentVersion' > node.currentVersion`.

- **TaskLinkCounts Realtime Convergence (Requirement 3)**: After a `linkNodeToTask` mutation followed by waiting for the Project_Channel event, the `setTaskLinkCounts` store value for the affected node equals the count returned by `getTaskLinkCounts` server action. Formally: `eventually(store.taskLinkCount[nodeId] == server.getTaskLinkCounts(nodeId))`.

- **IDB Session Key Round-Trip (Requirement 13.4)**: For all valid `(nodeId, filename)` pairs, writing a session under the new key format and reading it back via `findSessionByFilename` returns equivalent session data. Formally: `write(nodeId, session) |> findSessionByFilename(nodeId, filename) == session`.
