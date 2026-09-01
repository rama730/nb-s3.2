import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) =>
  readFileSync(`src/components/projects/v2/files-tab/${path}`, "utf8");

test("collection navigation lives in the sidebar, not a second project header", () => {
  const sidebar = read("FilesTabSidebar.tsx"),
    workspace = read("FilesWorkspaceViews.tsx");
  assert.match(sidebar, /aria-label="File collections"/);
  assert.match(sidebar, /Back to Files/);
  assert.match(sidebar, /workspaceView\.showCollections/);
  assert.match(sidebar, /workspaceView\.selectView/);
  assert.doesNotMatch(workspace, /<nav/);
  for (const collection of [
    "project",
    "tasks",
    "deliverables",
    "github",
    "recent",
    "starred",
    "trash",
  ])
    assert.ok(workspace.includes(`id: "${collection}"`));
  assert.match(
    sidebar,
    /item\.id !== "github" \|\| workspaceView\.canOpenGitHub/,
  );
  assert.match(workspace, /value !== "github" \|\| canOpenGitHub/);
});

test("row actions are shared across project, task and saved collections; selection is opt-in", () => {
  const folder = read("folder/FolderListView.tsx"),
    row = read("folder/FolderListRow.tsx");
  assert.match(folder, /setSelectionMode\] = React\.useState\(false\)/);
  assert.match(folder, /Actions for \$\{node\.name\}/);
  assert.match(folder, /renderMenu\(node\)/);
  assert.doesNotMatch(row, /function arePropsEqual/);
  assert.match(row, /canEdit && onSelectionChange/);
  for (const path of ["TaskFilesCollection.tsx", "SavedFilesCollection.tsx"])
    assert.match(read(path), /<FolderListView/);
  assert.doesNotMatch(folder, />\s*Refresh\s*</);
});

test("collection return retains search and scroll and asks before discarding edits", () => {
  const workspace = read("FilesWorkspaceViews.tsx");
  assert.match(workspace, /filesGroupQuery/);
  assert.match(workspace, /scrollOffsets/);
  assert.match(workspace, /dirtyFileId/);
  assert.match(workspace, /Discard unsaved changes/);
  assert.match(
    read("folder/FolderListView.tsx"),
    /scrollOffsets.current.get\(scrollKey\)/,
  );
});

test("Trash has mandatory per-item destructive confirmation and failure-safe reconciliation", () => {
  const trash = read("TrashFilesCollection.tsx");
  assert.match(trash, /getPermanentDeleteImpact/);
  assert.match(trash, /deletion\.fingerprint/);
  assert.match(trash, /autoCloseOnConfirm=\{false\}/);
  assert.match(trash, /response.status === "pending"/);
  assert.match(trash, /canManageFiles/);
  assert.match(trash, /permanentDeleteRoot/);
});

test("task unlink never substitutes global file deletion", () => {
  const task = read("TaskFilesCollection.tsx");
  assert.match(task, /Remove file from this task/);
  assert.match(task, /unlinkNodeFromTask\(taskId, unlinkTarget.id\)/);
  assert.doesNotMatch(task, /await (trashNode|deleteNode)\(/);
});

test("small-screen inspectors use the shared focus-contained dialog", () => {
  assert.match(
    read("file/FileInspectorContainer.tsx"),
    /presentation="right-drawer"/,
  );
  assert.match(read("GitHubSyncWorkspace.tsx"), /<Dialog open=|<Dialog\s/);
  assert.match(read("FilesTabMain.tsx"), /<GitHubSyncWorkspace/);
  assert.doesNotMatch(read("FilesTabRoot.tsx"), /FilesWorkspaceGitHubDrawer/);
  assert.match(read("file/FileView.tsx"), /FileInspectorContainer/);
  assert.doesNotMatch(
    read("../preview/AssetPreview.tsx"),
    /docs\.google\.com\/gview/,
  );
});

test("deliverable approval is scoped to the explicit review action and protects reserved metadata", () => {
  const task = readFileSync("src/app/actions/task.ts", "utf8");
  const approvalStart = task.indexOf(
    "export async function approveTaskReviewAction",
  );
  assert.doesNotMatch(
    task.slice(
      task.indexOf("export async function updateTaskStatusAction"),
      approvalStart,
    ),
    /markTaskFileVersionApproved\(/,
  );
  assert.match(task.slice(approvalStart), /locked.reviewStatus !== "pending"/);
  assert.match(
    task.slice(approvalStart),
    /markTaskFileVersionApproved\(file.tags, file.currentVersion, file.revisedAt\)/,
  );
  const links = readFileSync("src/app/actions/files/links.ts", "utf8");
  assert.match(links, /!tag.startsWith\("approved_version:"\)/);
  assert.match(links, /!tag.startsWith\("approved_revision_at:"\)/);
  assert.match(links, /withStoredApprovalTags\(updates.tags\)/);
});

test("upload decisions, Undo and task search failures have explicit accessible outcomes", () => {
  const decision = readFileSync(
    "src/components/projects/v2/explorer/useUploadCollisionDecision.tsx",
    "utf8",
  );
  assert.match(decision, /DialogTitle>Some names already exist/);
  assert.match(decision, /finish\("keep_both"\)/);
  assert.match(decision, /resolveRef.current\?\.\("cancel"\)/);
  const undo = readFileSync(
    "src/components/projects/v2/explorer/useExplorerOperationLog.ts",
    "utf8",
  );
  assert.match(undo, /if \(running \|\| completed\) return/);
  assert.match(undo, /action: \{ label: operation.undo.label/);
  const mutations = readFileSync("src/app/actions/files/mutations.ts", "utf8");
  assert.match(
    mutations,
    /current.updatedAt.toISOString\(\) !== expectedUpdatedAt/,
  );
  assert.match(
    mutations,
    /node.deletedAt\?\.toISOString\(\) !== expectedDeletedAt/,
  );
  const picker = read("picker/TaskSearchPicker.tsx");
  assert.match(picker, /Could not load tasks/);
  assert.match(picker, /type="radio" name="task-file-role"/);
  const revision = readFileSync(
    "src/components/ui/RevisionControlModal.tsx",
    "utf8",
  );
  assert.match(revision, /type="radio" name="file-revision-mode"/);
  assert.match(
    picker,
    /if \(isSaving \|\| isLoading \|\| error \|\| query !== debouncedQuery\) return/,
  );
});

test("the sidebar has one navigation model and no second legacy Trash reader", () => {
  const sidebar = read("FilesTabSidebar.tsx");
  assert.doesNotMatch(sidebar, /getTrashNodes|loadTrash|setTrashNodes\]/);
  assert.match(read("TrashFilesCollection.tsx"), /Original location:/);
  assert.match(read("TrashFilesCollection.tsx"), /deletedByName/);
});

test("GitHub Sync is a linked-account collection with state-driven, reviewed actions", () => {
  const root = read("FilesTabRoot.tsx");
  const main = read("GitHubSyncWorkspace.tsx");
  assert.match(root, /fetchGithubImportAccessState/);
  assert.match(root, /githubAccess\?\.linked === true/);
  assert.match(main, /Create a repository/);
  assert.match(main, /Connect an existing repository/);
  assert.match(main, /Review push/);
  assert.match(main, /Review pull/);
  assert.match(main, /Restore GitHub access/);
  assert.match(main, /startGithubRepositoryAuthorization/);
  assert.match(main, /fetchGithubImportRepositories/);
  assert.match(main, /fetchGithubImportBranches/);
  assert.doesNotMatch(main, /<GitHubCommitIdentity \/>/);
  assert.doesNotMatch(main, /aria-label="Sync operation history"/);
  assert.doesNotMatch(main, /aria-label="Project file contributors"/);
  assert.doesNotMatch(main, /Connect \/ reauthorize GitHub/);
});

test("GitHub OAuth assigns privacy-safe attribution without blocking login", () => {
  const callback = readFileSync("src/app/auth/callback/route.ts", "utf8");
  const identity = readFileSync(
    "src/lib/github/contributor-identity.ts",
    "utf8",
  );
  assert.match(callback, /ensureDefaultGithubContributorIdentity/);
  assert.match(callback, /Attribution enrichment must never block/);
  assert.match(identity, /@users\.noreply\.github\.com/);
  assert.match(identity, /current\?\.email \|\| githubNoreplyEmail/);
});
