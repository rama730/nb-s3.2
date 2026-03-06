"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { Virtuoso } from "react-virtuoso";
import { DraggableTab } from "../DraggableTab";
import { BreadcrumbBar } from "../navigation/BreadcrumbBar";
import FileEditor from "../FileEditor";
import AssetViewer from "../preview/AssetViewer";
import { isAssetLike } from "../utils/fileKind";
import type { ProjectNode } from "@/lib/db/schema";
import type { FilesWorkspaceTabState, PaneId } from "../state/filesTabTypes";
import { getFileContent } from "@/stores/filesWorkspaceStore";

interface EditorPaneProps {
  projectId: string;
  paneId: PaneId;
  canEdit: boolean;
  width: string;
  tabIds: string[];
  activeTabId: string | null;
  pinnedById: Record<string, boolean>;
  tabById: Record<string, FilesWorkspaceTabState>;
  prefs: { lineNumbers: boolean; wordWrap: boolean; fontSize: number; minimap: boolean };
  setActivePane: () => void;
  setActiveTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onPinTab: (id: string, pinned: boolean) => void;
  onCloseOthers: (id: string) => void;
  onCloseToRight: (id: string) => void;
  onChange: (id: string, next: string) => void;
  onSave: (id: string) => void;
  onRetryLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onCrumbClick: (folderId: string) => void;
  onNavigatePathNode: (node: ProjectNode) => void;
  onNavigateToAsset?: (node: ProjectNode) => void;
  conflictDiffNodeId: string | null;
  conflictDiffSignal: number;
  onRun?: () => void;
  canRun?: boolean;
  gitChangedFiles: Array<{ nodeId: string; status: "modified" | "added" | "deleted" }>;
}

export default function EditorPane({
  projectId,
  paneId,
  canEdit,
  width,
  tabIds,
  activeTabId,
  pinnedById,
  tabById,
  prefs,
  setActivePane,
  setActiveTab,
  onCloseTab,
  onPinTab,
  onCloseOthers,
  onCloseToRight,
  onChange,
  onSave,
  onRetryLoad,
  onDelete,
  onCrumbClick,
  onNavigatePathNode,
  onNavigateToAsset,
  conflictDiffNodeId,
  conflictDiffSignal,
  onRun,
  canRun,
  gitChangedFiles,
}: EditorPaneProps) {
  const activeTab = activeTabId ? tabById[activeTabId] : null;

  // Phase 5: Read content from detached Map (O(1), no React diffing)
  const contentForEditor = React.useMemo(() => {
    if (!activeTabId) return "";
    // contentVersion dependency triggers re-compute without storing the string in state
    const _v = activeTab?.contentVersion;
    return getFileContent(projectId, activeTabId);
  }, [projectId, activeTabId, activeTab?.contentVersion]);

  // Item 3: Auto-toggle minimap for files > 200 lines
  const isLargeFile = React.useMemo(() => {
    if (!contentForEditor) return false;
    let count = 0;
    for (let i = 0; i < contentForEditor.length; i++) {
      if (contentForEditor.charCodeAt(i) === 10) count++;
      if (count > 200) return true;
    }
    return false;
  }, [contentForEditor]);

  // Phase 5: Read saved snapshot from detached Map for diff view
  const savedSnapshotForEditor = React.useMemo(() => {
    if (!activeTabId) return "";
    const _v = activeTab?.savedSnapshotVersion;
    return getFileContent(projectId, `${activeTabId}::saved`);
  }, [projectId, activeTabId, activeTab?.savedSnapshotVersion]);

  // Stable object ref: only changes when isLargeFile or prefs actually change
  const effectivePrefs = React.useMemo(
    () => ({ ...prefs, minimap: isLargeFile }),
    [prefs, isLargeFile]
  );

  const gitStatus = React.useMemo(() => {
    if (!activeTabId) return null;
    return gitChangedFiles.find((f) => f.nodeId === activeTabId)?.status ?? null;
  }, [activeTabId, gitChangedFiles]);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ width }}>
      {/* Tabs */}
      <div
        className={cn(
          "flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/70 backdrop-blur px-2 py-1 overflow-hidden whitespace-nowrap",
          paneId === "right" && "border-l border-zinc-200 dark:border-zinc-800"
        )}
        onMouseDown={setActivePane}
      >
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          {(() => {
            const pinnedIds = tabIds.filter((id) => !!pinnedById[id]);
            const unpinnedIds = tabIds.filter((id) => !pinnedById[id]);
            const hasBothSections = pinnedIds.length > 0 && unpinnedIds.length > 0;

            if (tabIds.length === 0) {
              return <div className="px-2 py-1 text-xs text-zinc-400">No tabs</div>;
            }

            return (
              <>
                {pinnedIds.map((id) => {
                  const tab = tabById[id];
                  const name = tab?.node?.name || id;
                  const isActive = id === activeTabId;
                  const isDirty = !!tab?.isDirty;
                  return (
                    <DraggableTab
                      key={id}
                      id={id}
                      name={name}
                      isActive={isActive}
                      isDirty={isDirty}
                      isPinned
                      compact={!isActive}
                      onActivate={() => setActiveTab(id)}
                      onClose={() => onCloseTab(id)}
                      onPin={(p) => onPinTab(id, p)}
                      onCloseOthers={() => onCloseOthers(id)}
                      onCloseToRight={() => onCloseToRight(id)}
                    />
                  );
                })}
                {hasBothSections && (
                  <div className="w-px h-4 bg-zinc-300 dark:bg-zinc-600 mx-1 flex-shrink-0" />
                )}
                {unpinnedIds.length > 0 && (
                  <div className="flex-1 min-w-0 self-stretch flex items-center relative">
                    <Virtuoso
                      horizontalDirection
                      data={unpinnedIds}
                      style={{ height: "34px", width: "100%" }}
                      itemContent={(index, id) => {
                        const tab = tabById[id];
                        const name = tab?.node?.name || id;
                        const isActive = id === activeTabId;
                        const isDirty = !!tab?.isDirty;
                        return (
                          <div className="mr-1 h-full flex items-center mt-0.5">
                            <DraggableTab
                              key={id}
                              id={id}
                              name={name}
                              isActive={isActive}
                              isDirty={isDirty}
                              isPinned={false}
                              onActivate={() => setActiveTab(id)}
                              onClose={() => onCloseTab(id)}
                              onPin={(p) => onPinTab(id, p)}
                              onCloseOthers={() => onCloseOthers(id)}
                              onCloseToRight={() => onCloseToRight(id)}
                            />
                          </div>
                        );
                      }}
                    />
                  </div>
                )}
              </>
            );
          })()}
        </SortableContext>
      </div>

      {/* Breadcrumbs */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2">
        <BreadcrumbBar
          projectId={projectId}
          node={activeTab?.node ?? null}
          onCrumbClick={onCrumbClick}
          onNavigateNode={onNavigatePathNode}
        />
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden min-h-0 min-w-0">
        {activeTab ? (
          isAssetLike(activeTab.node) && activeTab.assetUrl ? (
            <AssetViewer
              projectId={projectId}
              node={activeTab.node}
              signedUrl={activeTab.assetUrl}
              onNavigateToAsset={onNavigateToAsset}
              onClose={() => onCloseTab(activeTab.id)}
            />
          ) : (
            <FileEditor
              file={activeTab.node}
              content={contentForEditor}
              savedSnapshot={savedSnapshotForEditor}
              isDirty={activeTab.isDirty}
              isLoading={activeTab.isLoading}
              isSaving={activeTab.isSaving}
              isDeleting={activeTab.isDeleting}
              error={activeTab.error}
              canEdit={canEdit && activeTab.hasLock}
              lockInfo={activeTab.lockInfo}
              offlineQueued={activeTab.offlineQueued}
              lineNumbers={effectivePrefs.lineNumbers}
              wordWrap={effectivePrefs.wordWrap}
              fontSize={effectivePrefs.fontSize}
              minimapEnabled={effectivePrefs.minimap}
              lastSavedAt={activeTab.lastSavedAt}
              onChange={(next) => onChange(activeTab.id, next)}
              onSave={() => onSave(activeTab.id)}
              onRetryLoad={() => onRetryLoad(activeTab.id)}
              onDelete={() => onDelete(activeTab.id)}
              openDiffSignal={
                conflictDiffNodeId && activeTab.id === conflictDiffNodeId
                  ? conflictDiffSignal
                  : undefined
              }
              onRun={onRun}
              canRun={canRun}
              gitStatus={gitStatus}
              tabId={activeTab.id}
            />
          )
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-zinc-400">
            Select a tab
          </div>
        )}
      </div>
    </div>
  );
}

export type { EditorPaneProps };
