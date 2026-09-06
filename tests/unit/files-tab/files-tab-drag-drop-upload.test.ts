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

  it("FolderListView enforces guaranteed drag state teardown and overlay resilience", () => {
    const source = readFileSync(folderListViewPath, "utf-8");

    // 1. Must define unified resetDragState
    assert.match(source, /const resetDragState = React\.useCallback\(\(\) => \{/);
    assert.match(source, /dragCounterRef\.current = 0;/);
    assert.match(source, /setIsDragActive\(false\);/);

    // 2. Must register and cleanup global window dragend / drop / Escape listeners
    assert.match(source, /window\.addEventListener\("dragend", handleGlobalDragEnd\)/);
    assert.match(source, /window\.addEventListener\("drop", handleGlobalDrop\)/);
    assert.match(source, /window\.addEventListener\("keydown", handleGlobalKeyDown\)/);
    assert.match(source, /window\.removeEventListener\("dragend", handleGlobalDragEnd\)/);
    assert.match(source, /window\.removeEventListener\("drop", handleGlobalDrop\)/);
    assert.match(source, /window\.removeEventListener\("keydown", handleGlobalKeyDown\)/);

    // 3. Must reset drag state in handleDesktopFileDrop
    assert.match(source, /const handleDesktopFileDrop = React\.useCallback\([\s\S]*?resetDragState\(\);/);

    // 4. Must reset drag state on modal onCancel
    assert.match(source, /onCancel=\{\(\) => \{[\s\S]*?resetDragState\(\);/);

    // 5. Must reset drag state in handleConfirmDropUpload finally block
    assert.match(source, /finally \{[\s\S]*?resetDragState\(\);/);

    // 6. Mutual exclusivity: overlay must NOT render while pendingUploadFiles modal is open
    assert.match(source, /\{isDragActive && !pendingUploadFiles && \(/);

    // 7. Dismissible overlay: must provide click-to-dismiss and close button
    assert.match(source, /onClick=\{resetDragState\}/);
    assert.match(source, /aria-label="Dismiss drop overlay"/);
  });

  it("FileView enforces single-file drop-zone teardown and window listeners", () => {
    const fileViewPath = path.resolve(
      process.cwd(),
      "src/components/projects/v2/files-tab/file/FileView.tsx",
    );
    const source = readFileSync(fileViewPath, "utf-8");

    // Must define resetDragState and window listeners
    assert.match(source, /const resetDragState = React\.useCallback\(\(\) => \{/);
    assert.match(source, /window\.addEventListener\("dragend", handleGlobalDragEnd\)/);
    assert.match(source, /window\.addEventListener\("keydown", handleGlobalKeyDown\)/);
    assert.match(source, /window\.removeEventListener\("dragend", handleGlobalDragEnd\)/);

    // Must be dismissible
    assert.match(source, /aria-label="Dismiss drop overlay"/);
  });

  it("FilesTabUploadModal supports single-back-button full-length project-tree isolation", () => {
    const source = readFileSync(modalPath, "utf-8");

    // Must track expandedCard state for full-length tree view
    assert.match(source, /const \[expandedCard, setExpandedCard\] = useState<"project" \| "deliverable" \| null>\(null\);/);

    // Must provide Back to categories button when expanded
    assert.match(source, /onClick=\{\(\) => setExpandedCard\(null\)\}/);
    assert.match(source, /Back to categories/);

    // Must conditionally render Categories Overview when expandedCard === null
    assert.match(source, /\{expandedCard === null && \(/);

    // Must render isolated full-length Project Files tree view when expandedCard === "project"
    assert.match(source, /\{expandedCard === "project" && \(/);

    // Must render isolated full-length Final Deliverable tree view when expandedCard === "deliverable"
    assert.match(source, /\{expandedCard === "deliverable" && \(/);

    // Must render FolderPicker inside both expanded tree views
    const projectSection = source.slice(
      source.indexOf('{expandedCard === "project" && ('),
      source.indexOf('{expandedCard === "deliverable" && ('),
    );
    assert.match(projectSection, /<FolderPicker/);
    assert.doesNotMatch(projectSection, /Task Reference/);
    assert.doesNotMatch(projectSection, /Working File/);
    assert.doesNotMatch(projectSection, /New Version of Existing File/);

    const deliverableSection = source.slice(
      source.indexOf('{expandedCard === "deliverable" && ('),
      source.indexOf("<DialogFooter"),
    );
    assert.match(deliverableSection, /<FolderPicker/);
    assert.doesNotMatch(deliverableSection, /Project Files/);
    assert.doesNotMatch(deliverableSection, /Task Reference/);
    assert.doesNotMatch(deliverableSection, /Working File/);
  });

  it("10 Ponytail Enhancements: FolderPicker ancestral auto-expansion & useFilesWorkspaceStore parent resolution", () => {
    const dialogsHostPath = path.resolve(
      process.cwd(),
      "src/components/projects/v2/explorer/ExplorerDialogsHost.tsx",
    );
    const source = readFileSync(dialogsHostPath, "utf-8");

    // Must import useFilesWorkspaceStore
    assert.match(source, /useFilesWorkspaceStore/);

    // Must traverse parent chain to auto-expand selected folder's ancestors on mount
    assert.match(source, /initialExpanded/);
    assert.match(source, /curr = nodesById\[curr\.parentId\]/);
    assert.match(source, /initialExpanded\[curr\.parentId\] = true/);
    assert.match(source, /loadPage\(ancestorId\)/);
  });

  it("10 Ponytail Enhancements: 2-level Escape, destination pill, smart category heuristics, removable chips & transitions", () => {
    const source = readFileSync(modalPath, "utf-8");

    // 2-level Escape: intercept onEscapeKeyDown and onKeyDown
    assert.match(source, /onEscapeKeyDown=\{/);
    assert.match(source, /e\.key === "Escape" && expandedCard !== null/);

    // Destination badge / breadcrumb pill in header
    assert.match(source, /Destination:/);
    assert.match(source, /destinationFolderName/);

    // Smart category heuristics: computeInitialIntent
    assert.match(source, /computeInitialIntent/);
    assert.match(source, /spec\|brief\|reference\|req\|asset\|guide\|input/);
    assert.match(source, /draft\|wip\|temp\|working/);

    // Removable chips list with remove button & aggregate size
    assert.match(source, /formatBytes\(totalBytes\)/);
    assert.match(source, /fileList\.map\(\(file, idx\) =>/);
    assert.match(source, /aria-label=\{`Remove \$\{file\.name\}`\}/);

    // Zero-byte preflight warning banner
    assert.match(source, /zeroByteFiles/);
    assert.match(source, /0-byte file warning:/);

    // Smooth layout transitions
    assert.match(source, /animate-in fade-in-50 duration-150/);
  });

  it("10 Ponytail Enhancements: Fast-MIME fallback resolution and typed return in useExplorerMutations", () => {
    const mutationsPath = path.resolve(
      process.cwd(),
      "src/components/projects/v2/explorer/useExplorerMutations.ts",
    );
    const source = readFileSync(mutationsPath, "utf-8");

    // Fast-MIME dictionary and resolver
    assert.match(source, /FALLBACK_EXT_MIME/);
    assert.match(source, /resolveFileMimeType\(file: File\): string/);
    assert.match(source, /resolveFileMimeType\(f\)/);

    // uploadFiles and uploadFilesDirectly return Promise<ProjectNode[]>
    assert.match(source, /async \(files: File\[\], parentId: string \| null\): Promise<ProjectNode\[\]>/);
    assert.match(source, /return createdNodes;/);
  });

  it("10 Ponytail Enhancements: Client-side OS junk stripping, optimistic modal teardown & deterministic task linking", () => {
    const source = readFileSync(folderListViewPath, "utf-8");

    // Strip OS junk files (.DS_Store, Thumbs.db, desktop.ini, ._*)
    assert.match(source, /stripOsJunkFiles/);
    assert.match(source, /const OS_JUNK_NAMES = new Set\(\["\.ds_store", "thumbs\.db", "desktop\.ini"\]\);/);

    // Optimistic teardown: pendingUploadFiles reset immediately before background upload
    assert.match(source, /setPendingUploadFiles\(null\);[\s\S]*?uploadFilesDirectly\(filesToUpload, target\)/);

    // Deterministic task linking: uses createdNodes directly from uploadFilesDirectly without scanning nodesById
    assert.match(source, /uploadFilesDirectly\(filesToUpload, target\)\s*\.then\(async \(createdNodes\) => \{[\s\S]*?for \(const node of createdNodes\) \{[\s\S]*?await linkNodeToTask\(result\.taskId, node\.id/);
    assert.doesNotMatch(source, /currentNodes = useFilesWorkspaceStore\.getState\(\)/);
  });
});
