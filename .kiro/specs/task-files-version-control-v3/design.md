# Design Document

## Overview

Phase 2 delivers end-to-end V3 alignment of the task↔files↔versions surface. It replaces both V2 file pickers with a unified V3 picker, surfaces reverse-links (file→tasks) in the Files tab, brings version control to the V3 file view, integrates version events into the sprint timeline, and removes all remaining V2 explorer code. Two bug fixes (sidebar reopen, editor theme) are included.

The design follows the same patterns established in Phase 1: single source of truth via `filesWorkspaceStore`, presentation-only row components, and hook-based data access.

### Dependency Order

```
Thread 0 (Foundation) → Thread 1 (Picker) → Thread 2 (Reverse-links) → Thread 3 (Versioning) → Thread 4 (Sprint/Telemetry) → Thread 5 (Cleanup)
```

## Architecture

### Component Tree (additions to Phase 1)

```
FilesTabRoot (MODIFIED — mounts Project_Channel)
├── FilesTabSidebar (MODIFIED — remove sr-only on expand button)
├── FilesTabMain (MODIFIED — add Sidebar_Reopen_Control)
│   ├── BreadcrumbBar
│   ├── FolderListView
│   │   └── FolderListRow (MODIFIED — add TaskLinkChip)
│   └── FileView (MODIFIED — add drop-zone, drawer slot)
│       ├── MetadataStrip (MODIFIED — add "View history", TaskLinkChip)
│       ├── FileActionsBar (MODIFIED — add Replace, Attach to task, LinkedTasks toggle)
│       ├── PreviewRegion / TextViewer (MODIFIED — theme fix)
│       └── DrawerSlot (NEW — hosts LinkedTasksPanel OR FileVersionHistoryPanel)
├── QuickOpenDialog
├── V3AttachmentPicker (NEW — portal, opened from task surfaces)
│   ├── PickerTree (FilesTabSidebar in navigate-only mode)
│   ├── PickerSearchResults / PickerRecents
│   └── PickerSelectedTray
└── TaskSearchPicker (NEW — portal, opened from FileActionsBar)
```

### Data Flow — Realtime

```
Supabase → Project_Channel (lazy, 1 channel, 2 bindings)
  ├── task_node_links INSERT/DELETE → setTaskLinkCounts → TaskLinkChip re-render
  └── file_versions INSERT → patchNodeVersion → VersionPill + MetadataStrip re-render
```

### Data Flow — Version Replace from Files Tab

```
User clicks "Replace…" → native file picker → file selected
  → useFileVersions.saveAsNewVersion(file)
    → getUploadPresignedUrl → PUT blob to S3
    → replaceNodeWithNewVersion (lock check → file_versions INSERT → project_nodes UPDATE)
    → realtime event → patchNodeVersion → UI updates
    → notification fan-out (file_version_added or task_file_replaced)
```

### Data Flow — Attach from Files Tab

```
User clicks "Attach to task…" → TaskSearchPicker opens → user selects task
  → linkNodeToTask(taskId, nodeId)
    → task_node_links INSERT
    → realtime event → setTaskLinkCounts → TaskLinkChip updates
```

## Components and Interfaces

### useFileVersions (Req 1)

**Location:** `src/hooks/useFileVersions.ts`

```typescript
interface LockConflictInfo {
  lockedBy: { userId: string; displayName: string; lockedAt: string };
}

interface UseFileVersionsReturn {
  versions: FileVersion[];
  isLoading: boolean;
  error: string | null;
  listVersions: () => Promise<FileVersion[]>;
  saveAsNewVersion: (
    file: File,
    options?: { comment?: string | null }
  ) => Promise<
    | { success: true; node: ProjectNode; version: FileVersion }
    | { success: false; error: string; lockConflict?: LockConflictInfo }
  >;
  restoreVersion: (versionNumber: number) => Promise<
    | { success: true; version: FileVersion }
    | { success: false; error: string }
  >;
}

function useFileVersions(projectId: string, nodeId: string): UseFileVersionsReturn;
```

### useTaskLinks (Req 2)

**Location:** `src/hooks/useTaskLinks.ts`

```typescript
interface LinkedTask {
  taskId: string;
  title: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
  annotation: string | null;
  linkedAt: string;
}

interface UseTaskLinksReturn {
  tasks: LinkedTask[];
  count: number;
  isLoading: boolean;
  error: string | null;
  link: (taskId: string) => Promise<{ success: boolean; error?: string }>;
  unlink: (taskId: string) => Promise<{ success: boolean; error?: string }>;
  updateAnnotation: (taskId: string, annotation: string) => Promise<{ success: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

function useTaskLinks(projectId: string, nodeId: string): UseTaskLinksReturn;
```

### Project_Channel (Req 3)

**Location:** `src/lib/realtime/project-files-channel.ts`

```typescript
interface ProjectFilesChannelOptions {
  projectId: string;
  onTaskLinkChange: (event: { nodeId: string; type: "INSERT" | "DELETE" }) => void;
  onFileVersionChange: (event: { nodeId: string; newVersion: number }) => void;
  onStatus?: (status: REALTIME_SUBSCRIBE_STATES) => void;
}

function subscribeProjectFilesChannel(
  supabase: SupabaseClient,
  options: ProjectFilesChannelOptions
): RealtimeChannel;
```

Mounted in `FilesTabRoot.tsx` via `useEffect`. Unmounted on cleanup.

### V3AttachmentPicker (Req 6)

**Location:** `src/components/projects/v2/files-tab/picker/V3AttachmentPicker.tsx`

```typescript
interface V3AttachmentPickerProps {
  projectId: string;
  projectName?: string;
  isOpen: boolean;
  onClose: () => void;
  initialSelection?: ProjectNode[];
  onSelectionChange?: (nodes: ProjectNode[]) => void;
}
```

### MultiAttachmentPicker (Req 6.5)

**Location:** `src/components/projects/v2/files-tab/picker/MultiAttachmentPicker.tsx`

```typescript
interface MultiAttachmentPickerProps {
  projectId: string;
  projectName?: string;
  isOpen: boolean;
  onClose: () => void;
  initialAttachments: ProjectNode[];
  onConfirm: (nodes: ProjectNode[]) => void;
}
```

### SingleAttachmentPicker (Req 6.6)

**Location:** `src/components/projects/v2/files-tab/picker/SingleAttachmentPicker.tsx`

```typescript
interface SingleAttachmentPickerProps {
  projectId: string;
  taskId: string;
  isOpen: boolean;
  onClose: () => void;
  existingAttachments: ProjectNode[];
}
```

### TaskLinkChip (Req 7)

**Location:** `src/components/projects/v2/files-tab/TaskLinkChip.tsx`

```typescript
interface TaskLinkChipProps {
  count: number;
  onClick: (event: React.MouseEvent) => void;
  className?: string;
}
```

### LinkedTasksPanel (Req 8)

**Location:** `src/components/projects/v2/files-tab/file/LinkedTasksPanel.tsx`

```typescript
interface LinkedTasksPanelProps {
  projectId: string;
  nodeId: string;
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
}
```

### FileVersionHistoryPanel (Req 10, 14)

**Location:** `src/components/projects/v2/files-tab/file/FileVersionHistoryPanel.tsx`

Same props as existing `FileVersionHistoryDrawer`. Moved, not rewritten.

### TaskSearchPicker (Req 9)

**Location:** `src/components/projects/v2/files-tab/picker/TaskSearchPicker.tsx`

```typescript
interface TaskSearchPickerProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (taskId: string) => void;
}
```

## Data Models

### Store Changes

**`src/stores/files/filesSlice.ts`:**

New action:
```typescript
patchNodeVersion: (projectId: string, nodeId: string, currentVersion: number) => void;
```

Patches `nodesById[nodeId].currentVersion` in place, bumps `treeVersion` by 1. Does NOT rebuild children or folder meta.

**`setTaskLinkCounts`:** Already exists. Ensure zero values are written (not filtered) so TaskLinkChip disappears on unlink.

### Server Actions

**New:** `getTaskLinksForNode(projectId: string, nodeId: string)` in `src/app/actions/files/links.ts`

Joins `task_node_links` → `tasks` → `profiles` (for assignee). Returns `LinkedTask[]`.

**Modified:** `replaceNodeWithNewVersion` in `src/app/actions/files/versions.ts`

Add lock check inside the existing transaction:
```sql
SELECT locked_by, locked_by_name, expires_at
FROM project_node_locks
WHERE node_id = $nodeId AND expires_at > NOW() AND locked_by != $currentUserId
```

If found → return `{ error: "lock_conflict", lockedBy: {...} }` without mutating.

**Modified:** Notification emission — after `replaceNodeWithNewVersion` succeeds without a task context, emit `file_version_added` to: file favoriters + last 5 distinct editors + linked-task participants.

### Database

No new tables. No migrations. All data models already exist (`file_versions`, `task_node_links`, `project_nodes`, `project_node_locks`).

## Correctness Properties

### Property 1: Picker Selection Round-Trip

For any set of Project_Nodes selected in the V3AttachmentPicker, confirming the selection and re-opening the picker with the same initial selection displays the same set of chips in the pinned tray. Formally: `confirm(select(nodes)) |> reopen |> getChips == nodes`.

**Validates: Requirements 6.5**

### Property 2: Reverse-Link Consistency

For any node, the TaskLinkChip count equals the length of the `tasks` array returned by `useTaskLinks`. Formally: `TaskLinkChip.count == useTaskLinks(projectId, nodeId).tasks.length`.

**Validates: Requirements 7.5, 2.9**

### Property 3: Version Count Invariant

For all nodes, `listVersions(projectId, nodeId).length >= node.currentVersion`. The version array always contains at least as many entries as the current version number indicates.

**Validates: Requirements 1.7**

### Property 4: Restore Monotonicity

For any sequence of `restoreVersion` calls, the resulting `currentVersion` on the node is strictly greater than the `currentVersion` before the restore. Formally: `restoreVersion(v) => node.currentVersion' > node.currentVersion`.

**Validates: Requirements 10.6**

### Property 5: TaskLinkCounts Realtime Convergence

After a `linkNodeToTask` mutation followed by waiting for the Project_Channel event, the `setTaskLinkCounts` store value for the affected node equals the count returned by `getTaskLinkCounts` server action. Formally: `eventually(store.taskLinkCounts[nodeId] == server.getTaskLinkCounts(nodeId))`.

**Validates: Requirements 3.4**

### Property 6: IDB Session Key Round-Trip

For all valid `(nodeId, filename)` pairs, writing a session under the new key format and reading it back via `findSessionByNodeId` returns equivalent session data. Formally: `write(nodeId, session) |> findSessionByNodeId(nodeId) == session`.

**Validates: Requirements 13.4**

## Error Handling

| Error | Source | Handling |
|-------|--------|----------|
| Lock conflict | `replaceNodeWithNewVersion` | Show inline "Locked by {name}" in FileActionsBar; disable Replace button |
| Upload failure | S3 PUT | Toast error; orphan blob cleanup (best-effort DELETE) |
| Link failure | `linkNodeToTask` | Toast error; picker stays open for retry |
| Channel disconnect | Project_Channel | Exponential backoff reconnect (800ms → 10s cap) |
| Soft-deleted node | `FileVersionHistoryPanel` | Read-only mode; "This file is in the trash" banner; Restore disabled |
| Multi-file drop | FileView drop-zone | Toast "Only single-file drops accepted"; ignore drop |
| Hash match on drop | FileView drop-zone | Prompt "File is identical — re-upload anyway?" |

## Testing Strategy

### Property-Based Tests (4–6 properties, numRuns=100)

- Picker selection round-trip
- Reverse-link consistency
- Version count invariant
- Restore monotonicity
- TaskLinkCounts convergence
- IDB session key round-trip

### E2E Tests

Each test calls `recordAudit` per Req 25.

- V3 picker: create-task with multi-select
- V3 picker: in-panel attach
- V3 picker: search → attach → recents
- TaskLinkChip: link file → chip appears → click → popover
- LinkedTasksPanel: open → list tasks → click task → panel opens
- Version replace from Files tab → pill updates → history shows new version
- Version restore from Files tab → new version row → pill updates
- Drop-zone: single file drop → version bump
- Drop-zone: multi-file drop → toast rejection
- Viewer role: no Replace/Attach/Restore visible
- Sidebar reopen: collapse → reopen control visible → click → sidebar returns
- Editor theme: dark mode → editor uses dark theme
- Sprint timeline: version event renders as sub-row

### Unit Tests

- `useFileVersions`: cache invalidation, lock conflict mapping, restore semantics
- `useTaskLinks`: CRUD operations, count consistency
- `patchNodeVersion`: store patch without tree rebuild
- `subscribeProjectFilesChannel`: event dispatch mapping
- `findSessionByNodeId`: key format fallback
