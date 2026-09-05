import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("Files Tab Drag & Drop Upload Integration", () => {
  const modalPath = path.resolve(
    process.cwd(),
    "src/components/projects/v2/files-tab/upload/FilesTabUploadModal.tsx",
  );
  const folderListViewPath = path.resolve(
    process.cwd(),
    "src/components/projects/v2/files-tab/folder/FolderListView.tsx",
  );

  it("FilesTabUploadModal exports expected contract and intents", () => {
    const source = readFileSync(modalPath, "utf-8");

    // Must export the modal and confirm result type
    assert.match(source, /export function FilesTabUploadModal/);
    assert.match(source, /export type FilesUploadIntent =/);
    assert.match(source, /export interface FilesTabUploadConfirmResult/);

    // Must support all 5 intents (matching Task Panel UX + Project Files)
    assert.match(source, /"project"/);
    assert.match(source, /"reference"/);
    assert.match(source, /"working"/);
    assert.match(source, /"deliverable"/);
    assert.match(source, /"version"/);

    // Must provide categories
    assert.match(source, /Project Files/);
    assert.match(source, /Task Reference/);
    assert.match(source, /Working File/);
    assert.match(source, /Final Deliverable/);
    assert.match(source, /New Version of Existing File/);

    // Must support smart collision detection
    assert.match(source, /matchingExistingFile/);
    assert.match(source, /Matching file detected:/);

    // Must support folder picker & task search
    assert.match(source, /FolderPicker/);
    assert.match(source, /searchProjectTasks/);
  });

  it("FolderListView implements container drag & drop with overlay and upload modal", () => {
    const source = readFileSync(folderListViewPath, "utf-8");

    // Must import the modal
    assert.match(source, /FilesTabUploadModal/);

    // Must handle container-level drag events
    assert.match(source, /onDragEnter=\{handleDragEnter\}/);
    assert.match(source, /onDragOver=\{handleDragOver\}/);
    assert.match(source, /onDragLeave=\{handleDragLeave\}/);
    assert.match(source, /onDrop=\{handleDrop\}/);

    // Must mount visual drop overlay
    assert.match(source, /Drop files to upload/);

    // Must mount the categorization modal on drop
    assert.match(source, /<FilesTabUploadModal/);
    assert.match(source, /onConfirm=\{handleConfirmDropUpload\}/);

    // Must route new version saves to saveFileRevision
    assert.match(source, /saveFileRevision/);
    assert.match(source, /mode: "new_revision"/);
  });
});
