import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("task resources are scoped, cancellable, and quiet while hidden", () => {
  const resource = read("src/hooks/useTaskPanelResource.ts");
  const panel = read("src/components/projects/v2/tasks/TaskDetailPanel.tsx");
  const comments = read(
    "src/components/projects/v2/tasks/TaskDetailTabs/CommentsTab.tsx",
  );

  assert.match(resource, /activeTab\?: TaskPanelTab/);
  assert.match(resource, /enabled: activeTab === "comments"/);
  assert.match(resource, /taskIdRef\.current !== requestedTaskId/);
  assert.match(panel, /setShowRealtimeIssue\(true\), 3_000/);
  assert.match(panel, /role="tabpanel"/);
  assert.match(panel, /aria-controls=\{`task-panel-\$\{tab\.id\}`\}/);
  assert.match(comments, /typingStateRef/);
  assert.match(comments, /initialCommentLoadAttemptsRef\.current >= 20/);
});

test("task board ordering is conflict-safe and pagination-complete", () => {
  const tasks = read("src/components/projects/v2/TasksTab.tsx");
  const board = read("src/components/projects/v2/tasks/KanbanBoard.tsx");

  assert.match(tasks, /searchParams\.get\("taskScope"\)/);
  assert.match(tasks, /nextParams\.set\("taskScope", scope\)/);
  assert.match(tasks, /status: sectionStatus/);
  assert.match(board, /await moveTaskToWorkflowColumnAction/);
  assert.match(board, /taskMovePendingRef\.current/);
  assert.match(board, /isTaskDragLocked=\{hasNextPage \|\| isTaskMovePending\}/);
  assert.match(board, /Load all tasks before reordering/);
});

test("sprint detail paginates while lifecycle remains persisted", () => {
  const data = read("src/hooks/hub/useProjectTasksData.ts");
  const detail = read("src/lib/projects/sprint-detail.ts");
  const header = read("src/components/projects/tabs/sprint/SprintHeader.tsx");
  const timeline = read(
    "src/components/projects/tabs/sprint/SprintTimelineContent.tsx",
  );

  assert.match(data, /useInfiniteQuery/);
  assert.match(data, /fetchProjectSprintTimelinePageAction/);
  assert.match(data, /mergeSprintDetailPages/);
  assert.match(detail, /return sprint\.status/);
  assert.match(header, /Starts automatically on schedule/);
  assert.match(header, /Close sprint/);
  assert.doesNotMatch(header, /Start sprint|Reopen sprint/);
  assert.match(timeline, /Assign tasks from the Task board/);
  assert.match(timeline, /onLoadMore/);
});

test("files search, navigation, versions, trash, and pagination share owned paths", () => {
  const folder = read(
    "src/components/projects/v2/files-tab/folder/FolderListView.tsx",
  );
  const quickOpen = read(
    "src/components/projects/v2/files-tab/quick-open/QuickOpenDialog.tsx",
  );
  const sidebar = read(
    "src/components/projects/v2/files-tab/FilesTabSidebar.tsx",
  );
  const versions = read(
    "src/components/projects/v2/files-tab/file/FileVersionHistoryPanel.tsx",
  );
  const fileView = read(
    "src/components/projects/v2/files-tab/file/FileView.tsx",
  );
  const navigate = read(
    "src/components/projects/v2/files-tab/hooks/useNavigateTo.ts",
  );
  const root = read("src/components/projects/v2/files-tab/FilesTabRoot.tsx");

  assert.match(folder, /nextCursor/);
  assert.match(folder, /Load more/);
  assert.match(quickOpen, /import\("@\/app\/actions\/files\/nodes"\)/);
  assert.match(quickOpen, /getProjectNodes\(projectId, null, rawQuery, MAX_RESULTS\)/);
  assert.match(sidebar, /getTrashNodes/);
  assert.match(sidebar, /restoreNode/);
  assert.match(versions, /onVersionChangeStart/);
  assert.match(versions, /onVersionChanged/);
  assert.doesNotMatch(versions, /CustomEvent\("file:version-changed/);
  assert.doesNotMatch(fileView, /addEventListener\("file:version-changed/);
  assert.match(navigate, /setPendingNavigation\(projectId, \{ nodeId \}\)/);
  assert.match(root, /Discard unsaved changes\?/);
  assert.doesNotMatch(navigate, /window\.confirm/);
  assert.doesNotMatch(fileView, /window\.confirm/);
});
