import type { StateCreator } from "zustand";
import type { ProjectNode } from "@/lib/db/schema";
import type { FilesWorkspaceState, FileState, WorkspacePane } from "./types";
import { defaultWorkspace, parentKey } from "./types";
import { FILES_RUNTIME_BUDGETS, clampNumber } from "@/lib/files/runtime-budgets";
import { set as idbSet } from "idb-keyval";
import { setFileContent, getFileContent, deleteFileContent } from "./contentMap";

function syncIdbCache(projectId: string, nodesById: Record<string, ProjectNode>, childrenByParentId: Record<string, string[]>) {
  void idbSet(`nb-s3-workspace-${projectId}`, {
    nodesById,
    childrenByParentId
  }).catch(e => console.warn("Failed to save IDB cache", e));
}

function toEpochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function nodeRecencyScore(node: ProjectNode): number {
  const updatedAt = toEpochMs((node as { updatedAt?: unknown }).updatedAt);
  const createdAt = toEpochMs((node as { createdAt?: unknown }).createdAt);
  return Math.max(updatedAt, createdAt);
}

export interface FilesSlice {
  upsertNodes: (projectId: string, nodes: ProjectNode[]) => void;
  setChildren: (projectId: string, parentId: string | null, childIds: string[]) => void;
  setFolderPayload: (
    projectId: string,
    parentId: string | null,
    payload: { childIds: string[]; nextCursor: string | null; hasMore: boolean; loaded: boolean }
  ) => void;
  setNodesAndChildren: (
    projectId: string,
    nodes: ProjectNode[],
    parentId: string | null,
    childIds: string[],
    payload?: { nextCursor: string | null; hasMore: boolean; loaded: boolean }
  ) => void;
  markChildrenLoaded: (projectId: string, parentId: string | null) => void;
  setFolderMeta: (projectId: string, folderId: string | null, meta: { nextCursor: string | null; hasMore: boolean }) => void;
  removeNodeFromCaches: (projectId: string, nodeId: string) => void;
  setTaskLinkCounts: (projectId: string, counts: Record<string, number>) => void;
  setNodes: (projectId: string, nodes: ProjectNode[]) => void;
  setFileState: (projectId: string, nodeId: string, state: Partial<FileState>) => void;
  hydrateFromIdb: (
    projectId: string,
    nodesById: Record<string, ProjectNode>,
    childrenByParentId: Record<string, string[]>
  ) => void;
}

export function evictLruIfNeeded(
  fileStates: Record<string, FileState>,
  maxEntries: number,
  projectId?: string
): Record<string, FileState> {
  const entries = Object.entries(fileStates);
  if (entries.length <= maxEntries) return fileStates;

  const sorted = entries.sort(
    (a, b) => (a[1].lastAccessedAt ?? 0) - (b[1].lastAccessedAt ?? 0)
  );

  const result: Record<string, FileState> = {};
  const toKeep = sorted.filter(([, s]) => s.isDirty);
  const nonDirty = sorted.filter(([, s]) => !s.isDirty);
  const budget = Math.max(0, maxEntries - toKeep.length);
  const kept = nonDirty.slice(Math.max(0, nonDirty.length - budget));
  const keptIds = new Set([...toKeep, ...kept].map(([id]) => id));

  // Phase 5: Clean up detached Map entries for evicted nodes
  if (projectId) {
    for (const [id] of sorted) {
      if (!keptIds.has(id)) {
        deleteFileContent(projectId, id);
        deleteFileContent(projectId, `${id}::saved`);
      }
    }
  }

  for (const [id, s] of [...toKeep, ...kept]) {
    result[id] = s;
  }
  return result;
}

export function enforceNodesBudget(
  nodesById: Record<string, ProjectNode>,
  childrenByParentId: Record<string, string[]>,
  budget: number = 5000
): {
  nodesById: Record<string, ProjectNode>;
  childrenByParentId: Record<string, string[]>;
} {
  const entries = Object.entries(nodesById);
  if (entries.length <= budget) {
    return { nodesById, childrenByParentId };
  }

  // Keep the most recent nodes by explicit node timestamps.
  const entriesToKeep = entries
    .sort(([idA, nodeA], [idB, nodeB]) => {
      const scoreDiff = nodeRecencyScore(nodeB) - nodeRecencyScore(nodeA);
      if (scoreDiff !== 0) return scoreDiff;
      return idA.localeCompare(idB);
    })
    .slice(0, budget);

  const keysToKeepSet = new Set(entriesToKeep.map(([id]) => id));
  const result: Record<string, ProjectNode> = {};
  for (const [id, node] of entriesToKeep) {
    result[id] = node;
  }

  let childrenChanged = false;
  const prunedChildrenByParentId: Record<string, string[]> = {};
  for (const [parentId, childIds] of Object.entries(childrenByParentId)) {
    const filteredChildIds = childIds.filter((id) => keysToKeepSet.has(id));
    if (filteredChildIds.length !== childIds.length) childrenChanged = true;
    prunedChildrenByParentId[parentId] = filteredChildIds;
  }

  return {
    nodesById: result,
    childrenByParentId: childrenChanged ? prunedChildrenByParentId : childrenByParentId,
  };
}

export function estimateVisibleRowsBudget(ws: FilesWorkspaceState["byProjectId"][string] | undefined) {
  if (!ws) return FILES_RUNTIME_BUDGETS.fileCacheFallbackEntries;
  const selectedParentKey = parentKey(ws.selectedFolderId ?? null);
  const selectedFolderCount = ws.childrenByParentId[selectedParentKey]?.length ?? 0;
  const rootCount = ws.childrenByParentId[parentKey(null)]?.length ?? 0;
  const openTabsCount =
    (ws.panes.left.openTabIds?.length ?? 0) + (ws.panes.right.openTabIds?.length ?? 0);
  const estimatedVisibleRows = Math.max(selectedFolderCount, rootCount, openTabsCount, 16);
  return clampNumber(
    estimatedVisibleRows * 2,
    FILES_RUNTIME_BUDGETS.fileCacheMinEntries,
    FILES_RUNTIME_BUDGETS.fileCacheMaxEntries
  );
}

export const createFilesSlice: StateCreator<FilesWorkspaceState, [], [], FilesSlice> = (set) => ({
  upsertNodes: (projectId, nodes) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      if (nodes.length === 0) return state;
      const nextById = { ...ws.nodesById };
      let changed = false;
      for (const n of nodes) {
        const existing = nextById[n.id];
        if (!existing || existing.updatedAt?.getTime() !== n.updatedAt?.getTime()) {
          nextById[n.id] = n;
          changed = true;
        }
      }
      if (!changed) return state;
      const budgeted = enforceNodesBudget(nextById, ws.childrenByParentId, 5000);
      const limitedNodesById = budgeted.nodesById;
      const prunedChildrenByParentId = budgeted.childrenByParentId;

      const newWs = {
        ...ws,
        nodesById: limitedNodesById,
        childrenByParentId: prunedChildrenByParentId,
        treeVersion: ws.treeVersion + 1,
      };

      syncIdbCache(projectId, limitedNodesById, prunedChildrenByParentId);

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: newWs,
        },
      };
    }),

  setChildren: (projectId, parentId, childIds) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const key = parentKey(parentId);
      const nextChildren = { ...ws.childrenByParentId, [key]: Array.from(new Set(childIds)) };

      syncIdbCache(projectId, ws.nodesById, nextChildren);

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            childrenByParentId: nextChildren,
            treeVersion: ws.treeVersion + 1,
          },
        },
      };
    }),

  setFolderPayload: (projectId, parentId, payload) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const key = parentKey(parentId);
      const nextChildren = { ...ws.childrenByParentId, [key]: Array.from(new Set(payload.childIds)) };

      syncIdbCache(projectId, ws.nodesById, nextChildren);

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            childrenByParentId: nextChildren,
            loadedChildren: payload.loaded
              ? { ...ws.loadedChildren, [key]: true }
              : ws.loadedChildren,
            folderMeta: {
              ...ws.folderMeta,
              [key]: { nextCursor: payload.nextCursor, hasMore: payload.hasMore },
            },
            treeVersion: ws.treeVersion + 1,
          },
        },
      };
    }),

  setNodesAndChildren: (projectId, nodes, parentId, childIds, payload) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const key = parentKey(parentId);
      const nextById = { ...ws.nodesById };
      for (const n of nodes) nextById[n.id] = n;
      const nextChildren = { ...ws.childrenByParentId, [key]: Array.from(new Set(childIds)) };
      const budgeted = enforceNodesBudget(nextById, nextChildren, 5000);
      const limitedNodesById = budgeted.nodesById;
      const prunedChildrenByParentId = budgeted.childrenByParentId;

      syncIdbCache(projectId, limitedNodesById, prunedChildrenByParentId);

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            nodesById: limitedNodesById,
            childrenByParentId: prunedChildrenByParentId,
            loadedChildren: payload?.loaded
              ? { ...ws.loadedChildren, [key]: true }
              : ws.loadedChildren,
            folderMeta: payload
              ? {
                ...ws.folderMeta,
                [key]: { nextCursor: payload.nextCursor, hasMore: payload.hasMore },
              }
              : ws.folderMeta,
            treeVersion: ws.treeVersion + 1,
          },
        },
      };
    }),

  markChildrenLoaded: (projectId, parentId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const key = parentKey(parentId);
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            loadedChildren: { ...ws.loadedChildren, [key]: true },
            treeVersion: ws.treeVersion + 1,
          },
        },
      };
    }),

  setFolderMeta: (projectId, folderId, meta) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const key = parentKey(folderId);
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            folderMeta: { ...ws.folderMeta, [key]: meta },
            treeVersion: ws.treeVersion + 1,
          },
        },
      };
    }),

  removeNodeFromCaches: (projectId, nodeId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const nextById = { ...ws.nodesById };
      const node = nextById[nodeId];
      delete nextById[nodeId];

      const nextChildren = { ...ws.childrenByParentId };
      if (node) {
        const key = parentKey(node.parentId ?? null);
        if (nextChildren[key]) nextChildren[key] = nextChildren[key].filter((id) => id !== nodeId);
      } else {
        for (const k of Object.keys(nextChildren)) {
          nextChildren[k] = nextChildren[k].filter((id) => id !== nodeId);
        }
      }

      const nextRecents = ws.recents.filter((id) => id !== nodeId);
      const nextFav = { ...ws.favorites };
      delete nextFav[nodeId];
      const nextPinned = { ...ws.pinnedByTabId };
      delete nextPinned[nodeId];
      const nextFileStates = { ...ws.fileStates };
      delete nextFileStates[nodeId];

      // Phase 5: Clean up detached Map entries
      deleteFileContent(projectId, nodeId);
      deleteFileContent(projectId, `${nodeId}::saved`);

      const closeFromPane = (pane: WorkspacePane) => ({
        ...pane,
        openTabIds: pane.openTabIds.filter((id) => id !== nodeId),
        activeTabId: pane.activeTabId === nodeId ? null : pane.activeTabId,
      });

      syncIdbCache(projectId, nextById, nextChildren);

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            nodesById: nextById,
            childrenByParentId: nextChildren,
            recents: nextRecents,
            favorites: nextFav,
            pinnedByTabId: nextPinned,
            fileStates: nextFileStates,
            treeVersion: ws.treeVersion + 1,
            tabsVersion: ws.tabsVersion + 1,
            panes: {
              left: closeFromPane(ws.panes.left),
              right: closeFromPane(ws.panes.right),
            },
          },
        },
      };
    }),

  setTaskLinkCounts: (projectId, counts) =>
    set((state) => {
      const ws = state.byProjectId[projectId];
      if (!ws) return state;
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            taskLinkCounts: { ...ws.taskLinkCounts, ...counts },
          },
        },
      };
    }),

  setNodes: (projectId, nodes) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const nodesById = { ...ws.nodesById };
      const childrenByParentId = { ...ws.childrenByParentId };

      for (const node of nodes) {
        nodesById[node.id] = node;
        const pid = parentKey(node.parentId ?? null);
        const existing = childrenByParentId[pid];
        if (!existing) {
          childrenByParentId[pid] = [node.id];
        } else if (!existing.includes(node.id)) {
          childrenByParentId[pid] = [...existing, node.id];
        }
      }

      const budgeted = enforceNodesBudget(nodesById, childrenByParentId, 5000);
      const limitedNodesById = budgeted.nodesById;
      const prunedChildrenByParentId = budgeted.childrenByParentId;

      syncIdbCache(projectId, limitedNodesById, prunedChildrenByParentId);

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            nodesById: limitedNodesById,
            childrenByParentId: prunedChildrenByParentId,
            treeVersion: ws.treeVersion + 1
          },
        },
      };
    }),

  setFileState: (projectId, nodeId, fileState) =>
    set((state) => {
      const ws = state.byProjectId[projectId];
      if (!ws) return state;

      const prev = ws.fileStates[nodeId] || { content: "", contentVersion: 0, isDirty: false };
      const now = Date.now();

      // Phase 5: Route content to detached Map, keep Zustand lightweight
      const hasContentUpdate = fileState.content !== undefined;
      if (hasContentUpdate) {
        setFileContent(projectId, nodeId, fileState.content!);
      }

      const nextVersion = hasContentUpdate
        ? (prev.contentVersion ?? 0) + 1
        : (prev.contentVersion ?? 0);

      const next: FileState = {
        ...prev,
        ...fileState,
        content: "",  // Always empty in store — content lives in detached Map
        contentVersion: nextVersion,
        lastAccessedAt: now,
      };

      // Detect actual state change for early bailout
      const stateUnchanged =
        !hasContentUpdate &&
        prev.isDirty === next.isDirty &&
        prev.lastSavedAt === next.lastSavedAt;
      if (stateUnchanged && prev.lastAccessedAt && now - prev.lastAccessedAt < 5_000) {
        return state;
      }

      const maxEntries = estimateVisibleRowsBudget(ws);
      const nextFileStates = evictLruIfNeeded({ ...ws.fileStates, [nodeId]: next }, maxEntries, projectId);
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            fileStates: nextFileStates,
          },
        },
      };
    }),

  hydrateFromIdb: (projectId, nodesById, childrenByParentId) =>
    set((state) => {
      const ws = state.byProjectId[projectId];
      if (!ws) return state;
      // We only hydrate if we don't already have live data loaded to prevent overwriting new socket updates
      if (Object.keys(ws.nodesById).length > 0) return state;

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            nodesById,
            childrenByParentId,
            treeVersion: ws.treeVersion + 1,
          },
        },
      };
    }),
});
