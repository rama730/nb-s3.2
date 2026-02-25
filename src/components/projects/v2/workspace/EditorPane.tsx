"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { DraggableTab } from "../DraggableTab";
import { BreadcrumbBar } from "../navigation/BreadcrumbBar";
import FileEditor from "../FileEditor";
import AssetViewer from "../preview/AssetViewer";
import { isAssetLike } from "../utils/fileKind";
import type { ProjectNode } from "@/lib/db/schema";
import type { FilesWorkspaceTabState, PaneId } from "../state/filesTabTypes";

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
}: EditorPaneProps) {
  const activeTab = activeTabId ? tabById[activeTabId] : null;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ width }}>
      {/* Tabs */}
      <div
        className={cn(
          "flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/70 backdrop-blur px-2 py-1 overflow-x-auto",
          paneId === "right" && "border-l border-zinc-200 dark:border-zinc-800"
        )}
        onMouseDown={setActivePane}
      >
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          {tabIds.length === 0 ? (
            <div className="px-2 py-1 text-xs text-zinc-400">No tabs</div>
          ) : (
            tabIds.map((id) => {
              const tab = tabById[id];
              const name = tab?.node?.name || id;
              const isActive = id === activeTabId;
              const isDirty = !!tab?.isDirty;
              const pinned = !!pinnedById[id];
              return (
                <DraggableTab
                  key={id}
                  id={id}
                  name={name}
                  isActive={isActive}
                  isDirty={isDirty}
                  isPinned={pinned}
                  onActivate={() => setActiveTab(id)}
                  onClose={() => onCloseTab(id)}
                  onPin={(p) => onPinTab(id, p)}
                  onCloseOthers={() => onCloseOthers(id)}
                  onCloseToRight={() => onCloseToRight(id)}
                />
              );
            })
          )}
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
              content={activeTab.content}
              savedSnapshot={activeTab.savedSnapshot}
              isDirty={activeTab.isDirty}
              isLoading={activeTab.isLoading}
              isSaving={activeTab.isSaving}
              isDeleting={activeTab.isDeleting}
              error={activeTab.error}
              canEdit={canEdit && activeTab.hasLock}
              lockInfo={activeTab.lockInfo}
              offlineQueued={activeTab.offlineQueued}
              lineNumbers={prefs.lineNumbers}
              wordWrap={prefs.wordWrap}
              fontSize={prefs.fontSize}
              minimapEnabled={prefs.minimap}
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
