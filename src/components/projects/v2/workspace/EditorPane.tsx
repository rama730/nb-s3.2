"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { MoreVertical, PanelBottom, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DraggableTab } from "../DraggableTab";
import FileEditor from "../FileEditor";
import AssetViewer from "../preview/AssetViewer";
import { isAssetLike } from "../utils/fileKind";
import type { FilesWorkspaceTabState, PaneId } from "../state/filesTabTypes";
import type { CursorPresenceMap } from "./cursorProtocol";
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
  onNavigateToAsset?: (node: FilesWorkspaceTabState["node"]) => void;
  showGlobalControls: boolean;
  splitEnabled: boolean;
  bottomPanelCollapsed: boolean;
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
  conflictDiffNodeId: string | null;
  conflictDiffSignal: number;
  onRun?: () => void;
  canRun?: boolean;
  gitChangedFiles: Array<{ nodeId: string; status: "modified" | "added" | "deleted" }>;
  remoteCursors: CursorPresenceMap;
  onBroadcastCursor: (nodeId: string, line: number, column: number, selStart?: number, selEnd?: number) => void;
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
  onNavigateToAsset,
  showGlobalControls,
  splitEnabled,
  bottomPanelCollapsed,
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
  conflictDiffNodeId,
  conflictDiffSignal,
  onRun,
  canRun,
  gitChangedFiles,
  remoteCursors,
  onBroadcastCursor,
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
    () => ({ ...prefs, minimap: prefs.minimap && !isLargeFile }),
    [prefs, isLargeFile]
  );

  const gitStatus = React.useMemo(() => {
    if (!activeTabId) return null;
    return gitChangedFiles.find((f) => f.nodeId === activeTabId)?.status ?? null;
  }, [activeTabId, gitChangedFiles]);

  // Single-line tab layout with +X overflow menu.
  const tabsViewportRef = React.useRef<HTMLDivElement | null>(null);
  const [tabsViewportWidth, setTabsViewportWidth] = React.useState(0);

  React.useEffect(() => {
    const el = tabsViewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.floor(entries[0]?.contentRect?.width ?? 0);
      setTabsViewportWidth(nextWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const {
    visibleTabIds,
    hiddenTabIds,
    visiblePinnedIds,
    visibleUnpinnedIds,
  } = React.useMemo(() => {
    const pinnedIds = tabIds.filter((id) => !!pinnedById[id]);
    const unpinnedIds = tabIds.filter((id) => !pinnedById[id]);
    const orderedIds = [...pinnedIds, ...unpinnedIds];

    if (orderedIds.length === 0) {
      return {
        visibleTabIds: [] as string[],
        hiddenTabIds: [] as string[],
        visiblePinnedIds: [] as string[],
        visibleUnpinnedIds: [] as string[],
      };
    }

    if (tabsViewportWidth <= 0) {
      return {
        visibleTabIds: orderedIds,
        hiddenTabIds: [] as string[],
        visiblePinnedIds: pinnedIds,
        visibleUnpinnedIds: unpinnedIds,
      };
    }

    const TAB_SLOT_PX = 170;
    const maxSlots = Math.max(1, Math.floor((tabsViewportWidth - 8) / TAB_SLOT_PX));
    const needsOverflow = orderedIds.length > maxSlots;
    const visibleSlots = needsOverflow ? Math.max(1, maxSlots - 1) : maxSlots;

    let visible = orderedIds.slice(0, visibleSlots);
    if (activeTabId && orderedIds.includes(activeTabId) && !visible.includes(activeTabId)) {
      if (visible.length === 0) {
        visible = [activeTabId];
      } else {
        const pinnedSet = new Set(pinnedIds);
        const allVisiblePinned = visible.every((id) => pinnedSet.has(id));
        if (allVisiblePinned) {
          visible[visible.length - 1] = activeTabId;
        } else {
          let replaceIndex = visible.length - 1;
          for (let i = visible.length - 1; i >= 0; i--) {
            if (!pinnedSet.has(visible[i])) {
              replaceIndex = i;
              break;
            }
          }
          visible[replaceIndex] = activeTabId;
        }
      }
    }

    const dedupVisible: string[] = [];
    const seen = new Set<string>();
    for (const id of visible) {
      if (seen.has(id)) continue;
      seen.add(id);
      dedupVisible.push(id);
    }
    for (const id of orderedIds) {
      if (dedupVisible.length >= visibleSlots) break;
      if (seen.has(id)) continue;
      seen.add(id);
      dedupVisible.push(id);
    }

    const hidden = orderedIds.filter((id) => !seen.has(id));
    const visiblePinned = dedupVisible.filter((id) => pinnedIds.includes(id));
    const visibleUnpinned = dedupVisible.filter((id) => unpinnedIds.includes(id));

    return {
      visibleTabIds: dedupVisible,
      hiddenTabIds: hidden,
      visiblePinnedIds: visiblePinned,
      visibleUnpinnedIds: visibleUnpinned,
    };
  }, [tabIds, pinnedById, tabsViewportWidth, activeTabId]);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ width }}>
      {/* Unified header: Editor label + tabs in a single row */}
      <div
        className={cn(
          "flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/70 backdrop-blur px-2 py-1 overflow-hidden whitespace-nowrap",
          paneId === "right" && "border-l border-zinc-200 dark:border-zinc-800"
        )}
        onMouseDown={setActivePane}
      >
        <div className="shrink-0 px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Editor
        </div>
        <div
          ref={tabsViewportRef}
          className="flex-1 min-w-0 overflow-hidden"
          role="tablist"
          aria-label={`${paneId} editor tabs`}
        >
          <SortableContext items={visibleTabIds} strategy={horizontalListSortingStrategy}>
            {(() => {
              const hasBothSections = visiblePinnedIds.length > 0 && visibleUnpinnedIds.length > 0;
              if (visibleTabIds.length === 0) {
                return <div className="px-2 py-1 text-xs text-zinc-400">No tabs</div>;
              }

              return (
                <div className="flex items-center min-w-0 h-full">
                  {visiblePinnedIds.map((id) => {
                    const tab = tabById[id];
                    const name = tab?.node?.name || id;
                    const fullPath = tab?.node?.path || name;
                    const isActive = id === activeTabId;
                    const isDirty = !!tab?.isDirty;
                    return (
                      <DraggableTab
                        key={id}
                        id={id}
                        name={name}
                        title={fullPath}
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
                  {visibleUnpinnedIds.length > 0 && (
                    <div className="flex-1 min-w-0 self-stretch flex items-center overflow-hidden">
                      <div className="h-full min-w-full flex items-center whitespace-nowrap">
                        {visibleUnpinnedIds.map((id) => {
                          const tab = tabById[id];
                          const name = tab?.node?.name || id;
                          const fullPath = tab?.node?.path || name;
                          const isActive = id === activeTabId;
                          const isDirty = !!tab?.isDirty;
                          return (
                            <div key={id} className="mr-1 h-full flex items-center mt-0.5">
                              <DraggableTab
                                id={id}
                                name={name}
                                title={fullPath}
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
                        })}
                      </div>
                    </div>
                  )}
                  {hiddenTabIds.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs ml-1 shrink-0"
                          title={`${hiddenTabIds.length} hidden tabs`}
                          aria-label={`Show ${hiddenTabIds.length} hidden tabs`}
                        >
                          +{hiddenTabIds.length}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-auto">
                        {hiddenTabIds.map((id) => {
                          const tab = tabById[id];
                          const name = tab?.node?.name || id;
                          const fullPath = tab?.node?.path || name;
                          const isDirty = !!tab?.isDirty;
                          return (
                            <DropdownMenuItem
                              key={id}
                              onSelect={() => {
                                setActiveTab(id);
                              }}
                              className="flex items-center justify-between gap-2"
                              title={fullPath}
                            >
                              <span className="truncate">
                                {name}{isDirty ? " *" : ""}
                              </span>
                              <button
                                type="button"
                                className="inline-flex items-center justify-center rounded p-0.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                                aria-label={`Close ${name}`}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onCloseTab(id);
                                }}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })()}
          </SortableContext>
        </div>
        {showGlobalControls ? (
          <div className="shrink-0 flex items-center gap-1.5">
            <Button
              data-testid="files-workspace-toolbar-panel-toggle"
              size="sm"
              variant={!bottomPanelCollapsed ? "secondary" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={onToggleBottomPanel}
              title={bottomPanelCollapsed ? "Show panel (Ctrl+`)" : "Hide panel (Ctrl+`)"}
            >
              <PanelBottom className="w-3.5 h-3.5 mr-1.5" />
              Panel
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  data-testid="files-workspace-toolbar-menu"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                >
                  <MoreVertical className="w-3.5 h-3.5 mr-1.5" />
                  Workspace
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={onOpenQuickOpen}>Quick open</DropdownMenuItem>
                <DropdownMenuItem onClick={onOpenFindInProject}>Find in project</DropdownMenuItem>
                <DropdownMenuItem onClick={onOpenCommandPalette}>Command palette</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onToggleSplit}>
                  {splitEnabled ? "Single editor mode" : "Split editor mode"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onToggleLineNumbers}>
                  {prefs.lineNumbers ? "Hide" : "Show"} line numbers
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onToggleWordWrap}>
                  {prefs.wordWrap ? "Disable" : "Enable"} word wrap
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onToggleMinimap}>
                  {prefs.minimap ? "Hide" : "Show"} minimap
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onFontSizeDecrease}>Font size -</DropdownMenuItem>
                <DropdownMenuItem onClick={onFontSizeIncrease}>Font size +</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
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
              remoteCursors={remoteCursors}
              onBroadcastCursor={onBroadcastCursor}
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
