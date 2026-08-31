import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getTaskWorkingFilesDisplayName,
  isInternalTaskWorkingFilesNode,
  isProjectSystemRoot,
  TASK_WORKING_FILES_TITLE,
} from "@/lib/files/task-working-files";
import { buildNodePathMap } from "@/components/projects/v2/files-tab/quick-open/QuickOpenDialog";
import { getTaskFileAttributionLabel } from "@/components/projects/v2/tasks/components/TaskFileRow";

test("internal task storage paths stay hidden behind a user-facing collection", () => {
  const system = { name: ".system", path: "/.system", parentId: null };
  const collection = { name: "tasks", path: "/.system/tasks" };

  assert.equal(isProjectSystemRoot(system), true);
  assert.equal(isInternalTaskWorkingFilesNode(collection), true);
  assert.equal(
    getTaskWorkingFilesDisplayName(collection),
    TASK_WORKING_FILES_TITLE,
  );
});

test("task UUID folders use their enriched task title", () => {
  const folder = {
    name: "9fbd8943-e594-473c-8f82-5830851d1d7a",
    path: "/.system/tasks/9fbd8943-e594-473c-8f82-5830851d1d7a",
    metadata: { taskWorkingFilesDisplayName: "Update related files" },
  };

  assert.equal(getTaskWorkingFilesDisplayName(folder), "Update related files");
});

test("task UUID folders never leak their storage identifier", () => {
  const folder = {
    name: "9fbd8943-e594-473c-8f82-5830851d1d7a",
    path: "/.system/tasks/9fbd8943-e594-473c-8f82-5830851d1d7a",
  };

  assert.equal(
    getTaskWorkingFilesDisplayName(folder),
    TASK_WORKING_FILES_TITLE,
  );
});

test("quick-open paths omit .system and task UUID storage segments", () => {
  const systemId = "10000000-0000-4000-8000-000000000001";
  const collectionId = "10000000-0000-4000-8000-000000000002";
  const taskFolderId = "10000000-0000-4000-8000-000000000003";
  const fileId = "10000000-0000-4000-8000-000000000004";
  const taskStorageId = "9fbd8943-e594-473c-8f82-5830851d1d7a";
  const base = {
    projectId: "10000000-0000-4000-8000-000000000005",
    type: "folder" as const,
    size: 0,
    currentVersion: 1,
    syncStatus: "merged" as const,
    s3Key: null,
    mimeType: null,
    taskId: null,
    canonicalNodeId: null,
    metadata: {},
    gitHash: null,
    lastSyncedCommitSha: null,
    createdBy: null,
    deletedBy: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const nodes = {
    [systemId]: {
      ...base,
      id: systemId,
      parentId: null,
      name: ".system",
      path: "/.system",
    },
    [collectionId]: {
      ...base,
      id: collectionId,
      parentId: systemId,
      name: "tasks",
      path: "/.system/tasks",
    },
    [taskFolderId]: {
      ...base,
      id: taskFolderId,
      parentId: collectionId,
      name: taskStorageId,
      path: `/.system/tasks/${taskStorageId}`,
      metadata: { taskWorkingFilesDisplayName: "Update related files" },
    },
    [fileId]: {
      ...base,
      id: fileId,
      parentId: taskFolderId,
      type: "file" as const,
      name: "notes.pdf",
      path: `/.system/tasks/${taskStorageId}/notes.pdf`,
    },
  };

  assert.equal(
    buildNodePathMap(nodes).get(fileId),
    `${TASK_WORKING_FILES_TITLE}/Update related files/notes.pdf`,
  );
});

test("Files metadata reads apply task visibility without hiding authorized linked files", () => {
  const nodes = readFileSync("src/app/actions/files/nodes.ts", "utf8");
  assert.match(nodes, /canReadProjectTaskFiles\(readAccess\)/);
  assert.match(nodes, /normalizedQuery \|\| parentId/);
  assert.match(nodes, /assertTaskFileNodeVisible/);
});

test("managed task folders never expose direct create, upload, or drop mutations", () => {
  const folderList = readFileSync(
    "src/components/projects/v2/files-tab/folder/FolderListView.tsx",
    "utf8",
  );

  assert.match(folderList, /const canEditCurrentFolder = canEdit && !currentFolderIsSystemManaged/);
  assert.match(folderList, /canEdit: canEditCurrentFolder/);
  assert.match(folderList, /!isSystemManaged && canManageFiles/);
  assert.match(folderList, /!isSystemManaged && canEdit/);
  assert.match(folderList, /No task files have been added yet/);
});

test("task-file collection uses bounded prefetched file pages and canonical identities", () => {
  const collection = readFileSync("src/app/actions/files/collections.ts", "utf8");
  const client = readFileSync("src/components/projects/v2/files-tab/TaskFilesCollection.tsx", "utf8");
  assert.match(readFileSync("src/lib/files/task-file-collection-query.ts", "utf8"), /position <= 51/);
  assert.match(collection, /LIMIT 21/);
  assert.match(client, /initialData:/);
  assert.match(client, /getQueriesData/);
  assert.match(client, /<FolderListView/);
  assert.match(readFileSync("src/components/projects/v2/files-tab/folder/FolderListView.tsx", "utf8"), /upsertNodes\(projectId, collection.nodes\)/);
  assert.doesNotMatch(client, /parentId:/);
});

test("task-file attribution prefers the latest uploader and falls back safely", () => {
  assert.equal(
    getTaskFileAttributionLabel({
      updatedByName: "Ramanayudu CH",
      updatedByUsername: "ramanayudu_ch",
    }),
    "Ramanayudu CH",
  );
  assert.equal(
    getTaskFileAttributionLabel({ updatedByUsername: "ramanayudu_ch" }),
    "ramanayudu_ch",
  );
  assert.equal(
    getTaskFileAttributionLabel({ createdByName: "Legacy Creator" }),
    "Legacy Creator",
  );
  assert.equal(getTaskFileAttributionLabel({}), "Unknown");
});

test("Files and task attachments share one canonical attribution projection", () => {
  const nodes = readFileSync("src/app/actions/files/nodes.ts", "utf8");
  const links = readFileSync("src/app/actions/files/links.ts", "utf8");

  assert.match(nodes, /getFileAttributionByNodeId\(nodes\)/);
  assert.match(links, /getFileAttributionByNodeId\([\s\S]*?rows\.map/);
});
