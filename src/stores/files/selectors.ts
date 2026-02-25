import { useFilesWorkspaceStore } from "./index";
import { useShallow } from "zustand/react/shallow";
import type { WorkspacePane, ProjectWorkspaceState } from "./types";
import { ROOT_KEY } from "./types";

const EMPTY_IDS: string[] = [];

export const useActiveTab = (projectId: string, paneId: WorkspacePane["id"]) =>
  useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.panes[paneId]?.activeTabId ?? null);

export const useDirtyFiles = (projectId: string) =>
  useFilesWorkspaceStore(
    useShallow((s) => {
      const ws = s.byProjectId[projectId];
      if (!ws) return EMPTY_IDS;
      const ids = Object.entries(ws.fileStates)
        .filter(([, state]) => state.isDirty)
        .map(([id]) => id);
      return ids.length === 0 ? EMPTY_IDS : ids;
    })
  );

export const useExpandedFolders = (projectId: string) =>
  useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.expandedFolderIds ?? {});

export const useGitState = (projectId: string) =>
  useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.git);

export const useTerminalState = (projectId: string) =>
  useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.terminal);

export const useUiState = (projectId: string) =>
  useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.ui);

export function estimateVisibleRows(workspace?: ProjectWorkspaceState): number {
  if (!workspace) return 0;
  const selectedKey = workspace.selectedFolderId ?? ROOT_KEY;
  const selectedFolderCount = workspace.childrenByParentId[selectedKey]?.length ?? 0;
  const rootCount = workspace.childrenByParentId[ROOT_KEY]?.length ?? 0;
  const openTabs =
    workspace.panes.left.openTabIds.length + workspace.panes.right.openTabIds.length;
  return Math.max(selectedFolderCount, rootCount, openTabs, 0);
}

export const useEstimatedVisibleRows = (projectId: string) =>
  useFilesWorkspaceStore((s) => estimateVisibleRows(s.byProjectId[projectId]));
