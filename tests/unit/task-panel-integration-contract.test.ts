import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("task panel listens to its task row and exposes connection state", () => {
  const resource = read("src/lib/realtime/task-resource.ts");
  const hook = read("src/hooks/useTaskPanelResource.ts");
  assert.match(resource, /kind: "task"/);
  assert.match(resource, /table: "tasks"/);
  assert.match(hook, /setIsResourceConnected\(true\)/);
  assert.match(hook, /if \(event\.kind === "task"\)/);
  assert.match(hook, /void loadTask\(\)/);
  assert.match(resource, /generation/);
  assert.match(resource, /entry\.generation !== generation/);
});

test("task panel opens locally without serializing its internal identifier", () => {
  const taskTab = read("src/components/projects/v2/TasksTab.tsx");
  const hook = read("src/hooks/useTaskPanelResource.ts");
  const links = read("src/app/actions/files/links.ts");
  const fileMutations = read("src/hooks/useTaskFileMutations.ts");

  assert.match(taskTab, /router\.replace\(nextUrl, \{ scroll: false \}\);/);
  assert.doesNotMatch(taskTab, /nextParams\.set\("drawerId"/);
  assert.match(taskTab, /\["drawerType", "drawerId", "panelTab"\]/);
  assert.match(hook, /countsFromTask/);
  assert.match(hook, /queryClient\.fetchQuery/);
  assert.doesNotMatch(hook, /countTaskAttachments/);
  assert.doesNotMatch(hook, /task\.status === "done"/);
  assert.doesNotMatch(fileMutations, /table: "task_node_links"/);
  assert.match(links, /getTaskAttachments\(projectId: string, taskId: string\)/);
});

test("workspace task handoff opens the task panel without leaking drawer IDs into the URL", () => {
  const workspaceTasks = read("src/components/workspace/WorkspaceTasksTab.tsx");
  const dashboard = read(
    "src/components/projects/dashboard/ProjectDashboardClient.tsx",
  );
  const taskTab = read("src/components/projects/v2/TasksTab.tsx");

  assert.match(workspaceTasks, /setWorkspaceTaskHandoff/);
  assert.match(workspaceTasks, /router\.push\(url\)/);
  assert.doesNotMatch(workspaceTasks, /drawerType=task|drawerId=/);
  assert.match(dashboard, /workspaceInitialTaskId/);
  assert.match(taskTab, /openTask\(localTask, initialPanelTab, true\)/);
});

test("task panel close is a single deterministic URL replacement", () => {
  const taskTab = read("src/components/projects/v2/TasksTab.tsx");

  assert.match(taskTab, /const isTaskPanelClosingRef = useRef\(false\)/);
  assert.match(taskTab, /if \(isTaskPanelClosingRef\.current\) return;/);
  assert.match(taskTab, /isTaskPanelClosingRef\.current = true;/);
  assert.match(taskTab, /router\.replace\(nextUrl, \{ scroll: false \}\);/);
  assert.doesNotMatch(taskTab, /router\.back\(\)/);
  assert.match(taskTab, /if \(isTaskPanelClosingRef\.current\) return;\s*if \(\s*!initialOpenTaskId \|\|/s);
});

test("task panels no longer mount an activity surface or query", () => {
  const panel = read("src/components/projects/v2/tasks/TaskDetailPanel.tsx");
  const hook = read("src/hooks/useTaskPanelResource.ts");

  assert.doesNotMatch(panel, /ActivityTab|id: "activity"/);
  assert.doesNotMatch(hook, /getProjectTaskActivityAction|loadActivity/);
});

test("nested task links reach comment and file targets", () => {
  const taskTab = read("src/components/projects/v2/TasksTab.tsx");
  const panel = read("src/components/projects/v2/tasks/TaskDetailPanel.tsx");
  const comments = read(
    "src/components/projects/v2/tasks/TaskDetailTabs/CommentsTab.tsx",
  );
  const files = read(
    "src/components/projects/v2/tasks/TaskDetailTabs/FilesTab.tsx",
  );
  assert.match(taskTab, /preserveNestedTarget/);
  assert.match(panel, /initialCommentId=\{initialCommentId\}/);
  assert.match(panel, /initialFileId=\{initialFileId\}/);
  assert.match(comments, /task-comment-\$\{initialCommentId\}/);
  assert.match(files, /CSS\.escape\(initialFileId\)/);
});

test("task comments use the compact update-style thread while preserving task capabilities", () => {
  const comments = read(
    "src/components/projects/v2/tasks/TaskDetailTabs/CommentsTab.tsx",
  );
  const composer = read(
    "src/components/projects/v2/tasks/components/MentionComposer.tsx",
  );
  const presence = read("src/hooks/usePresenceTyping.ts");

  assert.match(comments, /ThreadRail/);
  assert.match(comments, /-top-3 left-1\/2 h-7/);
  assert.match(comments, /-bottom-3 left-1\/2 top-4/);
  assert.match(comments, /Back to all comments/);
  assert.match(comments, /View conversation/);
  assert.match(comments, /onToggleLike/);
  assert.match(comments, /MentionComposer/);
  assert.match(comments, /presenceStatus/);
  assert.doesNotMatch(comments, /isPresenceConnected/);
  assert.match(composer, /editorClassName/);
  assert.match(presence, /currentUserProfileRef/);
});

test("task-file navigation preserves fileId until the file viewer hydrates", () => {
  const files = read(
    "src/components/projects/v2/tasks/TaskDetailTabs/FilesTab.tsx",
  );
  const filesRoot = read(
    "src/components/projects/v2/files-tab/FilesTabRoot.tsx",
  );
  const urlSync = read(
    "src/components/projects/v2/files-tab/hooks/useFilesTabUrlSync.ts",
  );

  assert.match(
    files,
    /tab=files&fileId=\$\{encodeURIComponent\(node\.id\)\}/,
  );
  assert.match(files, /usePathname/);
  assert.match(filesRoot, /suspendWrites: Boolean/);
  assert.match(filesRoot, /completeInitialFileResolution/);
  assert.match(urlSync, /shouldPreserveTaskFileDeepLink/);
  assert.match(urlSync, /suspended: options\.suspendWrites/);
});

test("task uploads preserve the selected intent and destination", () => {
  const files = read(
    "src/components/projects/v2/tasks/TaskDetailTabs/FilesTab.tsx",
  );
  const modal = read(
    "src/components/projects/v2/tasks/components/TaskFileUploadModal.tsx",
  );

  assert.match(
    modal,
    /onConfirm\(intent, destinationFolderId \?\? undefined\)/,
  );
  assert.match(modal, /onConfirm\(intent, versionNodeId\)/);
  assert.match(files, /intent === "deliverable" \? targetNodeId : undefined/);
  assert.match(
    files,
    /toast\.error\(failed\.error \|\| "Failed to upload files"\)/,
  );
  assert.match(files, /Array\.from\(dataTransfer\.files \|\| \[\]\)/);
});

test("task deletion confirmation is layered above the detail panel", () => {
  const panel = read("src/components/projects/v2/tasks/TaskDetailPanel.tsx");
  const confirmDialog = read("src/components/ui/ConfirmDialog.tsx");

  assert.match(panel, /overlayClassName="z-\[300\]/);
  assert.match(panel, /contentClassName="z-\[301\]"/);
  assert.match(confirmDialog, /overlayClassName=\{overlayClassName\}/);
  assert.match(confirmDialog, /contentClassName/);
});

test("task file move dialog is roomy and layered above the detail panel", () => {
  const panel = read("src/components/projects/v2/tasks/TaskDetailPanel.tsx");
  const row = read(
    "src/components/projects/v2/tasks/components/TaskFileRow.tsx",
  );
  const dialogs = read(
    "src/components/projects/v2/explorer/ExplorerDialogsHost.tsx",
  );

  assert.match(panel, /sm:w-\[40vw\]/);
  assert.match(panel, /sm:max-w-\[40vw\]/);
  assert.match(panel, /grid-cols-4/);
  assert.match(panel, /overflow-visible/);
  assert.doesNotMatch(panel, /overflow-x-auto/);
  assert.match(dialogs, /overlayClassName="z-\[300\]/);
  assert.match(dialogs, /className="z-\[301\]/);
  assert.match(dialogs, /sm:max-w-2xl/);
  assert.match(dialogs, /h-\[min\(58vh,32rem\)\]/);
  assert.doesNotMatch(row, /<Dialog/);
  assert.doesNotMatch(row, /onSelect=\{\(event\) => \{\s*event\.preventDefault\(\);\s*setIsMoveModalOpen/);
});
