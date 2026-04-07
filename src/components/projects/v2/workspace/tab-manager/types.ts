import type React from "react";
import type { ProjectNode } from "@/lib/db/schema";
import type { FilesWorkspaceTabState, PaneId } from "../../state/filesTabTypes";

export interface ConflictDialogState {
  open: boolean;
  nodeId: string | null;
  message: string;
  diffSignal: number;
}

export interface UseTabManagerStoreActions {
  setFileState: (projectId: string, nodeId: string, state: Record<string, unknown>) => void;
  upsertNodes: (projectId: string, nodes: ProjectNode[]) => void;
  clearLock: (projectId: string, nodeId: string) => void;
  removeNodeFromCaches: (projectId: string, nodeId: string) => void;
  setLastNodeEventSummary: (
    projectId: string,
    nodeId: string,
    summary: { type: string; at: number; by: string | null }
  ) => void;
}

export interface TabManagerSharedOptions {
  projectId: string;
  canEdit: boolean;
  showToast: (msg: string, type?: "success" | "error" | "info" | "warning") => void;
  setTabById: React.Dispatch<React.SetStateAction<Record<string, FilesWorkspaceTabState>>>;
  tabByIdRef: React.MutableRefObject<Record<string, FilesWorkspaceTabState>>;
  nextLockAttemptAtRef: React.MutableRefObject<Map<string, number>>;
  storeActions: UseTabManagerStoreActions;
}

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export interface EnsureSaveResult {
  ok: boolean;
  code: "ok" | "tab_missing" | "lock_lost" | "lock_expired" | "node_missing" | "version_conflict";
  error?: string;
}

export interface TabDnDActions {
  reorderTabs: (projectId: string, paneId: PaneId, nextOpenTabIds: string[]) => void;
  moveTabToPane: (
    projectId: string,
    fromPane: PaneId,
    toPane: PaneId,
    tabId: string,
    toIndex: number
  ) => void;
}
