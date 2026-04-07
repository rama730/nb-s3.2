import type { StateCreator } from "zustand";
import type { FilesWorkspaceState, WorkspacePane } from "./types";
import { defaultWorkspace } from "./types";
import { evictLruIfNeeded, estimateVisibleRowsBudget } from "./filesSlice";
import { deleteFileContent } from "./contentMap";

function gcClosedTabs(ws: FilesWorkspaceState["byProjectId"][string], projectId: string, closedIds: string[]) {
  for (const id of closedIds) {
    const isDirty = ws.fileStates[id]?.isDirty;
    const isOpen = ws.panes.left.openTabIds.includes(id) || ws.panes.right.openTabIds.includes(id);
    if (!isDirty && !isOpen) {
      deleteFileContent(projectId, id);
      deleteFileContent(projectId, `${id}::saved`);
    }
  }
}

export interface WorkspaceSlice {
  setSplitEnabled: (projectId: string, enabled: boolean) => void;
  setSplitRatio: (projectId: string, ratio: number) => void;
  openTab: (projectId: string, paneId: WorkspacePane["id"], nodeId: string) => void;
  closeTab: (projectId: string, paneId: WorkspacePane["id"], nodeId: string) => void;
  pinTab: (projectId: string, paneId: WorkspacePane["id"], nodeId: string, pinned: boolean) => void;
  closeOtherTabs: (projectId: string, paneId: WorkspacePane["id"], keepNodeId: string) => void;
  closeTabsToRight: (projectId: string, paneId: WorkspacePane["id"], fromNodeId: string) => void;
  setActiveTab: (projectId: string, paneId: WorkspacePane["id"], nodeId: string | null) => void;
  reorderTabs: (projectId: string, paneId: WorkspacePane["id"], order: string[]) => void;
  moveTabToPane: (projectId: string, fromPaneId: WorkspacePane["id"], toPaneId: WorkspacePane["id"], nodeId: string, index?: number) => void;
  /** FW8: Remove tabs whose nodeId no longer exists in nodesById */
  pruneGhostTabs: (projectId: string) => void;
}

export const createWorkspaceSlice: StateCreator<FilesWorkspaceState, [], [], WorkspaceSlice> = (set) => ({
  setSplitEnabled: (projectId, enabled) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, splitEnabled: enabled },
        },
      };
    }),

  setSplitRatio: (projectId, ratio) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const clamped = Math.min(0.8, Math.max(0.2, ratio));
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, splitRatio: clamped },
        },
      };
    }),

  openTab: (projectId, paneId, nodeId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const pane = ws.panes[paneId];
      const openTabIds = pane.openTabIds.includes(nodeId)
        ? pane.openTabIds
        : [...pane.openTabIds, nodeId];
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            tabsVersion: ws.tabsVersion + 1,
            panes: {
              ...ws.panes,
              [paneId]: { ...pane, openTabIds, activeTabId: nodeId },
            },
          },
        },
      };
    }),

  closeTab: (projectId, paneId, nodeId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const pane = ws.panes[paneId];
      const openTabIds = pane.openTabIds.filter((id) => id !== nodeId);
      const activeTabId =
        pane.activeTabId === nodeId
          ? openTabIds[openTabIds.length - 1] ?? null
          : pane.activeTabId;
      const nextWs = {
        ...ws,
        tabsVersion: ws.tabsVersion + 1,
        panes: { ...ws.panes, [paneId]: { ...pane, openTabIds, activeTabId } },
      };

      gcClosedTabs(nextWs, projectId, [nodeId]);

      const budget = estimateVisibleRowsBudget(nextWs);
      nextWs.fileStates = evictLruIfNeeded(nextWs.fileStates, budget, projectId);

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: nextWs,
        },
      };
    }),

  pinTab: (projectId, _paneId, nodeId, pinned) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            pinnedByTabId: { ...ws.pinnedByTabId, [nodeId]: pinned },
          },
        },
      };
    }),

  closeOtherTabs: (projectId, paneId, keepNodeId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const pane = ws.panes[paneId];
      const openTabIds = pane.openTabIds.filter(
        (id) => id === keepNodeId || ws.pinnedByTabId[id]
      );
      const closedIds = pane.openTabIds.filter(
        (id) => id !== keepNodeId && !ws.pinnedByTabId[id]
      );
      const nextWs = {
        ...ws,
        tabsVersion: ws.tabsVersion + 1,
        panes: {
          ...ws.panes,
          [paneId]: { ...pane, openTabIds, activeTabId: keepNodeId },
        },
      };

      gcClosedTabs(nextWs, projectId, closedIds);

      const budget = estimateVisibleRowsBudget(nextWs);
      nextWs.fileStates = evictLruIfNeeded(nextWs.fileStates, budget, projectId);

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: nextWs,
        },
      };
    }),

  closeTabsToRight: (projectId, paneId, fromNodeId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const pane = ws.panes[paneId];
      const idx = pane.openTabIds.indexOf(fromNodeId);
      if (idx === -1) return state;
      const closedIds = pane.openTabIds.slice(idx + 1);
      const openTabIds = pane.openTabIds.slice(0, idx + 1);
      const activeTabId =
        pane.activeTabId && openTabIds.includes(pane.activeTabId)
          ? pane.activeTabId
          : fromNodeId;
      const nextWs = {
        ...ws,
        tabsVersion: ws.tabsVersion + 1,
        panes: {
          ...ws.panes,
          [paneId]: { ...pane, openTabIds, activeTabId },
        },
      };

      gcClosedTabs(nextWs, projectId, closedIds);

      const budget = estimateVisibleRowsBudget(nextWs);
      nextWs.fileStates = evictLruIfNeeded(nextWs.fileStates, budget, projectId);

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: nextWs,
        },
      };
    }),

  setActiveTab: (projectId, paneId, nodeId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const pane = ws.panes[paneId];
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            tabsVersion: ws.tabsVersion + 1,
            panes: { ...ws.panes, [paneId]: { ...pane, activeTabId: nodeId } },
          },
        },
      };
    }),

  reorderTabs: (projectId, paneId, order) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const pane = ws.panes[paneId];
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            tabsVersion: ws.tabsVersion + 1,
            panes: { ...ws.panes, [paneId]: { ...pane, openTabIds: order } },
          },
        },
      };
    }),

  moveTabToPane: (projectId, fromPaneId, toPaneId, nodeId, index) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const fromPane = ws.panes[fromPaneId];
      const toPane = ws.panes[toPaneId];

      if (!fromPane.openTabIds.includes(nodeId)) return state;

      const nextFromIds = fromPane.openTabIds.filter((id) => id !== nodeId);
      const nextFromActive =
        fromPane.activeTabId === nodeId
          ? nextFromIds[nextFromIds.length - 1] ?? null
          : fromPane.activeTabId;

      const nextToIds = [...toPane.openTabIds];
      if (index !== undefined && index >= 0) {
        nextToIds.splice(index, 0, nodeId);
      } else {
        nextToIds.push(nodeId);
      }

      const uniqueToIds = Array.from(new Set(nextToIds));

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            tabsVersion: ws.tabsVersion + 1,
            panes: {
              ...ws.panes,
              [fromPaneId]: { ...fromPane, openTabIds: nextFromIds, activeTabId: nextFromActive },
              [toPaneId]: { ...toPane, openTabIds: uniqueToIds, activeTabId: nodeId },
            },
          },
        },
      };
    }),

  // FW8: Prune tabs whose node IDs no longer exist in nodesById
  pruneGhostTabs: (projectId) =>
    set((state) => {
      const ws = state.byProjectId[projectId];
      if (!ws) return state;

      const knownIds = ws.nodesById;
      let changed = false;

      const prunePane = (pane: WorkspacePane): WorkspacePane => {
        const valid = pane.openTabIds.filter((id) => id in knownIds);
        if (valid.length === pane.openTabIds.length) return pane;
        changed = true;
        const ghostIds = pane.openTabIds.filter((id) => !(id in knownIds));
        gcClosedTabs(ws, projectId, ghostIds);
        return {
          ...pane,
          openTabIds: valid,
          activeTabId: pane.activeTabId && valid.includes(pane.activeTabId)
            ? pane.activeTabId
            : valid[valid.length - 1] ?? null,
        };
      };

      const left = prunePane(ws.panes.left);
      const right = prunePane(ws.panes.right);

      if (!changed) return state;
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            panes: { ...ws.panes, left, right },
          },
        },
      };
    }),
});
