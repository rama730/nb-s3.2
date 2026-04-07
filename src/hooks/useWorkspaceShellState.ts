import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { FilesViewMode } from "@/stores/filesWorkspaceStore";
import { useShallow } from "zustand/react/shallow";

const EMPTY_ARRAY: string[] = [];
const DEFAULT_PANES = {
  left: { openTabIds: [] as string[], activeTabId: null as string | null },
  right: { openTabIds: [] as string[], activeTabId: null as string | null },
};
const DEFAULT_PREFS = {
  lineNumbers: true,
  wordWrap: false,
  fontSize: 14,
  minimap: true,
  autosaveDelayMs: 2500,
  inactiveAutosaveConcurrency: 2,
};
const DEFAULT_PINNED: Record<string, boolean> = {};

/**
 * Bundles all per-project derived state selectors from `useFilesWorkspaceStore`
 * into a single `useShallow` subscription so that WorkspaceShell only re-renders
 * once per batch of store updates instead of once per selector.
 */
export function useWorkspaceShellState(projectId: string) {
  return useFilesWorkspaceStore(
    useShallow((s) => {
      const ws = s.byProjectId[projectId];
      const selectedNodeId = ws?.selectedNodeId ?? null;

      // Compute galleryChildIds inline to keep everything in one selector
      let galleryChildIds: string[] = EMPTY_ARRAY;
      if (ws) {
        const pk =
          selectedNodeId && ws.nodesById[selectedNodeId]?.type === "folder"
            ? selectedNodeId
            : "__root__";
        galleryChildIds = ws.childrenByParentId[pk] ?? EMPTY_ARRAY;
      }

      return {
        // Pane tab state
        leftOpenTabIds: ws?.panes?.left?.openTabIds || EMPTY_ARRAY,
        rightOpenTabIds: ws?.panes?.right?.openTabIds || EMPTY_ARRAY,
        leftActiveTabId: ws?.panes?.left?.activeTabId ?? null,
        rightActiveTabId: ws?.panes?.right?.activeTabId ?? null,

        // Layout
        splitEnabled: ws?.splitEnabled ?? false,
        splitRatio: ws?.splitRatio ?? 0.5,
        viewMode: ((ws?.viewMode as FilesViewMode) || "code") as FilesViewMode,
        panes: ws?.panes || DEFAULT_PANES,
        prefs: ws?.prefs || DEFAULT_PREFS,
        pinnedByTabId: ws?.pinnedByTabId || DEFAULT_PINNED,

        // UI chrome
        bottomPanelCollapsed: ws?.ui?.bottomPanelCollapsed ?? true,
        sidebarWidth: ws?.ui?.sidebarWidth ?? 290,
        sidebarCollapsed: ws?.ui?.sidebarCollapsed ?? false,
        zenMode: ws?.ui?.zenMode ?? false,

        // Git
        gitChangedFiles: ws?.git?.changedFiles || EMPTY_ARRAY,

        // Explorer
        selectedNodeId,
        galleryChildIds,

        // Actions (stable references — not derived from project state)
        pinTab: s.pinTab,
        closeOtherTabs: s.closeOtherTabs,
        closeTabsToRight: s.closeTabsToRight,
        setSplitEnabled: s.setSplitEnabled,
        setSplitRatio: s.setSplitRatio,
        setPrefs: s.setPrefs,
        setViewMode: s.setViewMode,
        setSelectedNode: s.setSelectedNode,
        requestScrollTo: s.requestScrollTo,
        toggleExpanded: s.toggleExpanded,
        removeNodeFromCaches: s.removeNodeFromCaches,
        setFileState: s.setFileState,
        toggleBottomPanel: s.toggleBottomPanel,
        setBottomPanelTab: s.setBottomPanelTab,
        setLastExecutionOutput: s.setLastExecutionOutput,
        setLastExecutionSettingsHref: s.setLastExecutionSettingsHref,
        setSidebarWidth: s.setSidebarWidth,
        toggleSidebar: s.toggleSidebar,
        toggleZenMode: s.toggleZenMode,
      };
    })
  );
}
