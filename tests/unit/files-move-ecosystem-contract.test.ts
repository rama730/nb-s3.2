import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

const mutations = read("src/app/actions/files/mutations.ts");
const helpers = read("src/lib/files/internal-helpers.ts");
const picker = read(
  "src/components/projects/v2/explorer/ExplorerDialogsHost.tsx",
);
const taskRow = read(
  "src/components/projects/v2/tasks/components/TaskFileRow.tsx",
);
const taskExplorer = read(
  "src/components/projects/v2/tasks/components/TaskFilesExplorer.tsx",
);
const treeRow = read(
  "src/components/projects/v2/explorer/FileTreeRow.tsx",
);
const realtime = read("src/lib/realtime/project-files-channel.ts");
const filesRoot = read("src/components/projects/v2/files-tab/FilesTabRoot.tsx");

test("one move action owns single, bulk, publish, audit, and undo validation", () => {
  assert.match(mutations, /export async function moveProjectNodes/);
  assert.doesNotMatch(mutations, /export async function (?:moveNode|bulkMoveNodes)/);
  assert.match(mutations, /expectedParentByNode/);
  assert.match(mutations, /mode\?: "move" \| "publish"/);
  assert.match(mutations, /recordNodeEvent[\s\S]*operationId[\s\S]*oldParentId[\s\S]*newParentId/);
  assert.match(mutations, /taskActivityEvents/);
});

test("move integrity is task-scoped, atomic, and reserved destinations fail closed", () => {
  assert.match(mutations, /task_id IS NOT DISTINCT FROM \$\{taskId\}/);
  assert.match(mutations, /deleted_at IS NULL/);
  assert.match(helpers, /assertValidMoveDestination/);
  assert.match(helpers, /internal task workspace cannot be used as a destination/);
  assert.match(helpers, /depth >= 256 \|\| visited\.has\(cursor\)/);
  assert.match(helpers, /ne\(projectNodeLocks\.lockedBy, userId\)/);
});

test("the shared picker hides internal storage and supports root, paging, search, and keyboard use", () => {
  assert.match(picker, /isInternalTaskWorkingFilesNode/);
  assert.match(picker, /> Project root/);
  assert.match(picker, /Load more folders/);
  assert.match(picker, /Load more matches/);
  assert.match(picker, /role="tree"/);
  assert.match(picker, /role="treeitem"/);
  assert.match(picker, /ArrowDown/);
  assert.match(picker, /aria-selected/);
});

test("task files separate role changes, relocation, and publishing", () => {
  assert.match(taskRow, /Move to Deliverables/);
  assert.match(taskRow, /Move in Project Files/);
  assert.match(taskRow, /Publish to Project Files/);
  assert.doesNotMatch(taskRow, /<Dialog/);
  assert.doesNotMatch(taskRow, /Open with/);
  assert.match(taskExplorer, /TASK_WORKING_FILES_TITLE/);
});

test("file relocation controls and drag sources require manage-files access", () => {
  assert.match(taskRow, /canManageFiles/);
  assert.match(treeRow, /draggable=\{canMove && !isRenaming\}/);
  assert.match(treeRow, /if \(!canMove \|\| isRenaming\) return/);
});

test("project node changes reconcile across connected file surfaces", () => {
  assert.doesNotMatch(realtime, /table: 'project_nodes'/);
  assert.doesNotMatch(realtime, /table: 'file_versions'/);
  assert.match(filesRoot, /loadFolderContent\(visibleFolderId, "refresh"\)/);
  assert.match(filesRoot, /window\.addEventListener\("focus", reconcileVisibleFolder\)/);
  assert.match(filesRoot, /window\.addEventListener\("online", reconcileVisibleFolder\)/);
  assert.match(filesRoot, /void supabase\.removeChannel\(channel\)/);
});
