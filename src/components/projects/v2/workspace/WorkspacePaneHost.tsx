"use client";

import React from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { FileCode } from "lucide-react";
import type { ProjectNode } from "@/lib/db/schema";
import type { CursorPresenceMap } from "./cursorProtocol";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { FilesWorkspaceTabState, PaneId } from "../state/filesTabTypes";
import EditorPane from "./EditorPane";
import AssetGallery from "../preview/AssetGallery";

interface WorkspacePaneHostProps {
  projectId: string;
  isActive: boolean;
  canEdit: boolean;
  splitEnabled: boolean;
  splitRatio: number;
  activePane: PaneId;
  panes: {
    left: { openTabIds: string[]; activeTabId: string | null };
    right: { openTabIds: string[]; activeTabId: string | null };
  };
  pinnedByTabId: Record<string, boolean>;
  tabById: Record<string, FilesWorkspaceTabState>;
  prefs: {
    lineNumbers: boolean;
    wordWrap: boolean;
    fontSize: number;
    minimap: boolean;
  };
  bottomPanelCollapsed: boolean;
  conflictNodeId: string | null;
  conflictDiffSignal: number;
  activeFilePath?: string;
  sensors: any[];
  nodesById: Record<string, ProjectNode>;
  selectedNodeId: string | null;
  rootNodes: ProjectNode[];
  viewMode: "code" | "assets" | "all";
  onDragEnd: (event: DragEndEvent) => void;
  onSetActivePane: (pane: PaneId) => void;
  onCloseTab: (paneId: PaneId, tabId: string) => void;
  onPinTab: (paneId: PaneId, tabId: string, pinned: boolean) => void;
  onCloseOthers: (paneId: PaneId, tabId: string) => void;
  onCloseToRight: (paneId: PaneId, tabId: string) => void;
  onTabChange: (tabId: string, content: string) => void;
  onSaveTab: (tabId: string) => void;
  onRetryLoad: (tabId: string) => void;
  onDeleteTab: (tabId: string) => void;
  onNavigateToAsset: (node: ProjectNode, paneId: PaneId) => void;
  onRunActiveFile: () => void;
  onOpenAsset: (node: ProjectNode) => void;
  onOpenFolderFromGallery: (folderId: string) => void;
  onStartResize: (event: React.MouseEvent) => void;
  onToggleBottomPanel: () => void;
  onOpenQuickOpen: () => void;
  onOpenFindInProject: () => void;
  onOpenCommandPalette: () => void;
  onToggleSplit: () => void;
  onToggleLineNumbers: () => void;
  onToggleWordWrap: () => void;
  onToggleMinimap: () => void;
  onFontSizeDecrease: () => void;
  onFontSizeIncrease: () => void;
  leftOrderedTabIds: string[];
  rightOrderedTabIds: string[];
  gitChangedFiles: Array<{ nodeId: string; status: "modified" | "added" | "deleted" }>;
  remoteCursors: CursorPresenceMap;
  onBroadcastCursor: (nodeId: string, line: number, column: number, selStart?: number, selEnd?: number) => void;
}

export function WorkspacePaneHost({
  projectId,
  isActive,
  canEdit,
  splitEnabled,
  splitRatio,
  activePane,
  panes,
  pinnedByTabId,
  tabById,
  prefs,
  bottomPanelCollapsed,
  conflictNodeId,
  conflictDiffSignal,
  activeFilePath,
  sensors,
  nodesById,
  selectedNodeId,
  rootNodes,
  viewMode,
  onDragEnd,
  onSetActivePane,
  onCloseTab,
  onPinTab,
  onCloseOthers,
  onCloseToRight,
  onTabChange,
  onSaveTab,
  onRetryLoad,
  onDeleteTab,
  onNavigateToAsset,
  onRunActiveFile,
  onOpenAsset,
  onOpenFolderFromGallery,
  onStartResize,
  onToggleBottomPanel,
  onOpenQuickOpen,
  onOpenFindInProject,
  onOpenCommandPalette,
  onToggleSplit,
  onToggleLineNumbers,
  onToggleWordWrap,
  onToggleMinimap,
  onFontSizeDecrease,
  onFontSizeIncrease,
  leftOrderedTabIds,
  rightOrderedTabIds,
  gitChangedFiles,
  remoteCursors,
  onBroadcastCursor,
}: WorkspacePaneHostProps) {
  const nothingOpen =
    panes.left.openTabIds.length === 0 && (!splitEnabled || panes.right.openTabIds.length === 0);

  return (
    <>
      <div className="relative z-10 flex-1 overflow-hidden flex">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <EditorPane
            projectId={projectId}
            isActive={isActive}
            paneId="left"
            canEdit={canEdit}
            width={splitEnabled ? `${splitRatio * 100}%` : "100%"}
            tabIds={leftOrderedTabIds}
            activeTabId={panes.left.activeTabId}
            pinnedById={pinnedByTabId}
            tabById={tabById}
            prefs={prefs}
            setActivePane={() => onSetActivePane("left")}
            setActiveTab={(id) => useFilesWorkspaceStore.getState().setActiveTab(projectId, "left", id)}
            onCloseTab={(id) => onCloseTab("left", id)}
            onPinTab={(id, pinned) => onPinTab("left", id, pinned)}
            onCloseOthers={(id) => onCloseOthers("left", id)}
            onCloseToRight={(id) => onCloseToRight("left", id)}
            onChange={onTabChange}
            onSave={onSaveTab}
            onRetryLoad={onRetryLoad}
            onDelete={onDeleteTab}
            onNavigateToAsset={(node) => onNavigateToAsset(node, "left")}
            showGlobalControls={!splitEnabled || activePane === "left"}
            splitEnabled={splitEnabled}
            bottomPanelCollapsed={bottomPanelCollapsed}
            onToggleBottomPanel={onToggleBottomPanel}
            onOpenQuickOpen={onOpenQuickOpen}
            onOpenFindInProject={onOpenFindInProject}
            onOpenCommandPalette={onOpenCommandPalette}
            onToggleSplit={onToggleSplit}
            onToggleLineNumbers={onToggleLineNumbers}
            onToggleWordWrap={onToggleWordWrap}
            onToggleMinimap={onToggleMinimap}
            onFontSizeDecrease={onFontSizeDecrease}
            onFontSizeIncrease={onFontSizeIncrease}
            conflictDiffNodeId={conflictNodeId}
            conflictDiffSignal={conflictDiffSignal}
            onRun={activePane === "left" ? onRunActiveFile : undefined}
            canRun={activePane === "left" && !!activeFilePath}
            gitChangedFiles={gitChangedFiles}
            remoteCursors={remoteCursors}
            onBroadcastCursor={onBroadcastCursor}
          />

          {splitEnabled ? (
            <div
              className="w-1 cursor-col-resize bg-zinc-200 dark:bg-zinc-800 hover:bg-indigo-300 dark:hover:bg-indigo-700 transition-colors"
              onMouseDown={onStartResize}
              aria-label="Resize split"
            />
          ) : null}

          {splitEnabled ? (
            <EditorPane
              projectId={projectId}
              isActive={isActive}
              paneId="right"
              canEdit={canEdit}
              width={`${(1 - splitRatio) * 100}%`}
              tabIds={rightOrderedTabIds}
              activeTabId={panes.right.activeTabId}
              pinnedById={pinnedByTabId}
              tabById={tabById}
              prefs={prefs}
              setActivePane={() => onSetActivePane("right")}
              setActiveTab={(id) => useFilesWorkspaceStore.getState().setActiveTab(projectId, "right", id)}
              onCloseTab={(id) => onCloseTab("right", id)}
              onPinTab={(id, pinned) => onPinTab("right", id, pinned)}
              onCloseOthers={(id) => onCloseOthers("right", id)}
              onCloseToRight={(id) => onCloseToRight("right", id)}
              onChange={onTabChange}
              onSave={onSaveTab}
              onRetryLoad={onRetryLoad}
              onDelete={onDeleteTab}
              onNavigateToAsset={(node) => onNavigateToAsset(node, "right")}
              showGlobalControls={activePane === "right"}
              splitEnabled={splitEnabled}
              bottomPanelCollapsed={bottomPanelCollapsed}
              onToggleBottomPanel={onToggleBottomPanel}
              onOpenQuickOpen={onOpenQuickOpen}
              onOpenFindInProject={onOpenFindInProject}
              onOpenCommandPalette={onOpenCommandPalette}
              onToggleSplit={onToggleSplit}
              onToggleLineNumbers={onToggleLineNumbers}
              onToggleWordWrap={onToggleWordWrap}
              onToggleMinimap={onToggleMinimap}
              onFontSizeDecrease={onFontSizeDecrease}
              onFontSizeIncrease={onFontSizeIncrease}
              conflictDiffNodeId={conflictNodeId}
              conflictDiffSignal={conflictDiffSignal}
              onRun={activePane === "right" ? onRunActiveFile : undefined}
              canRun={activePane === "right" && !!activeFilePath}
              gitChangedFiles={gitChangedFiles}
              remoteCursors={remoteCursors}
              onBroadcastCursor={onBroadcastCursor}
            />
          ) : null}
        </DndContext>
      </div>

      {nothingOpen ? (
        viewMode === "assets" ? (
          <div className="absolute inset-0 z-10 bg-white dark:bg-zinc-950">
            <AssetGallery
              projectId={projectId}
              folderId={selectedNodeId ?? "__root__"}
              nodes={rootNodes}
              onOpenAsset={onOpenAsset}
              onOpenFolder={onOpenFolderFromGallery}
            />
          </div>
        ) : (
          <div className="absolute inset-0 z-10 pointer-events-none flex flex-col items-center justify-center text-zinc-400 p-8 bg-white dark:bg-zinc-950">
            <div className="w-24 h-24 rounded-[2rem] bg-gradient-to-tr from-zinc-100 to-zinc-50 dark:from-zinc-900 dark:to-zinc-800 flex items-center justify-center mb-6 shadow-xl shadow-zinc-100 dark:shadow-black/20 border border-white dark:border-zinc-700">
              <FileCode className="w-10 h-10 text-zinc-300 dark:text-zinc-600" />
            </div>
            <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
              Select a file to start
            </h3>
            <p className="text-zinc-500 max-w-md text-center mb-4">
              Use the explorer on the left to open or create files. Your recent files and favorites
              are one click away.
            </p>
            <div className="flex items-center gap-3 text-xs text-zinc-500">
              <span className="px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 font-mono">
                Ctrl/⌘+P
              </span>
              <span>Quick open</span>
              <span className="text-zinc-300 dark:text-zinc-700">•</span>
              <span className="px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 font-mono">
                Ctrl/⌘+K
              </span>
              <span>Commands</span>
            </div>
          </div>
        )
      ) : null}
    </>
  );
}
