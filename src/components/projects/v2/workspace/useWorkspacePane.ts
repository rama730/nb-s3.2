"use client";

import { useCallback, useMemo } from "react";
import type { FilesWorkspaceTabState, PaneId } from "../state/filesTabTypes";

interface WorkspacePanesState {
  left: { openTabIds: string[]; activeTabId: string | null };
  right: { openTabIds: string[]; activeTabId: string | null };
}

function orderedTabIds(openIds: string[], pinnedById: Record<string, boolean>) {
  const pinned: string[] = [];
  const normal: string[] = [];
  for (const id of openIds) (pinnedById[id] ? pinned : normal).push(id);
  return [...pinned, ...normal];
}

interface UseWorkspacePaneOptions {
  panes: WorkspacePanesState;
  pinnedByTabId: Record<string, boolean>;
  activeTabIdByPane: Record<PaneId, string | null>;
  tabById: Record<string, FilesWorkspaceTabState>;
}

export function useWorkspacePane({
  panes,
  pinnedByTabId,
  activeTabIdByPane,
  tabById,
}: UseWorkspacePaneOptions) {
  const leftActiveTab = activeTabIdByPane.left ? tabById[activeTabIdByPane.left] : null;
  const rightActiveTab = activeTabIdByPane.right ? tabById[activeTabIdByPane.right] : null;

  const leftOrderedTabIds = useMemo(
    () => orderedTabIds(panes.left.openTabIds, pinnedByTabId),
    [panes.left.openTabIds, pinnedByTabId]
  );
  const rightOrderedTabIds = useMemo(
    () => orderedTabIds(panes.right.openTabIds, pinnedByTabId),
    [panes.right.openTabIds, pinnedByTabId]
  );

  const getPaneForTab = useCallback(
    (nodeId: string): PaneId | null => {
      if (panes.left.openTabIds.includes(nodeId)) return "left";
      if (panes.right.openTabIds.includes(nodeId)) return "right";
      return null;
    },
    [panes.left.openTabIds, panes.right.openTabIds]
  );

  return {
    leftActiveTab,
    rightActiveTab,
    leftOrderedTabIds,
    rightOrderedTabIds,
    getPaneForTab,
  };
}
