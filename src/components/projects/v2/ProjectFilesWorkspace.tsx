"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectNode } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui-custom/Toast";
import FileExplorer from "./explorer/FileExplorer";
import FileEditor from "./FileEditor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { DraggableTab } from "./DraggableTab";
import {
  FileCode,
  Layers,
  MoreVertical,
  Pin,
  PinOff,
  SplitSquareVertical,
  X,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  recordProjectNodeEvent,
  trashNode,
  acquireProjectNodeLock,
  findNodeByPathAny,
  getBreadcrumbs,
  getNodesByIds,
  refreshProjectNodeLock,
  releaseProjectNodeLock,
  searchProjectFileIndex,
  upsertProjectFileIndex,
  updateProjectFileStats,
  getProjectFileSignedUrl,
} from "@/app/actions/files";
import { getProjectSyncStatus, retryGithubImportAction } from "@/app/actions/project";
import { useRouter } from "next/navigation";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { BreadcrumbBar } from "./navigation/BreadcrumbBar";
import type { FilesViewMode } from "@/stores/filesWorkspaceStore";
import { isAssetLike, isTextLike } from "./utils/fileKind";
import AssetPreview from "./preview/AssetPreview";

const EMPTY_ARRAY: any[] = [];
const EMPTY_OBJECT: Record<string, any> = {};

interface ProjectFilesWorkspaceProps {
  projectId: string;
  projectName?: string;
  currentUserId?: string;
  isOwnerOrMember: boolean;
  syncStatus?: 'pending' | 'cloning' | 'indexing' | 'ready' | 'failed';
  importSourceType?: 'github' | 'upload' | 'scratch' | null;
}

const DEFAULT_PANES = { left: { openTabIds: [], activeTabId: null }, right: { openTabIds: [], activeTabId: null } };
const DEFAULT_PREFS = { lineNumbers: true, wordWrap: false, fontSize: 14, minimap: true };
const DEFAULT_NODES: Record<string, ProjectNode> = {};
const DEFAULT_PINNED: Record<string, boolean> = {};

type PaneId = "left" | "right";

type TabState = {
  id: string; // nodeId
  node: ProjectNode;
  content: string;
  savedSnapshot: string;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  hasLock: boolean;
  lockInfo?: { lockedBy: string; lockedByName?: string | null; expiresAt: number } | null;
  offlineQueued: boolean;
  error?: string | null;
  lastSavedAt?: number;
  assetUrl?: string | null;
  assetUrlExpiresAt?: number | null;
};

function orderedTabIds(openIds: string[], pinnedById: Record<string, boolean>) {
  const pinned: string[] = [];
  const normal: string[] = [];
  for (const id of openIds) (pinnedById[id] ? pinned : normal).push(id);
  return [...pinned, ...normal];
}

export default function ProjectFilesWorkspace({
  projectId,
  projectName,
  currentUserId,
  isOwnerOrMember,
  initialFileNodes,
  syncStatus: initialSyncStatus = 'ready',
  importSourceType,
}: ProjectFilesWorkspaceProps & { initialFileNodes?: ProjectNode[] }) {
  const canEdit = isOwnerOrMember;
  const { showToast } = useToast();
  const router = useRouter();

  // Sync Status Management
  const [syncState, setSyncState] = useState(initialSyncStatus);
  const showOverlay = syncState !== 'ready';
  const [syncPollError, setSyncPollError] = useState<string | null>(null);
  const [syncErrorReason, setSyncErrorReason] = useState<string | null>(null);
  const [retryLoading, setRetryLoading] = useState(false);
  const overlayStartedAtRef = useRef<number | null>(showOverlay ? Date.now() : null);
  const pollDelayRef = useRef<number>(3000);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [forceUpdate, setForceUpdate] = useState(0);

  // Poll for sync status if not ready
  useEffect(() => {
    let cancelled = false;

    const isVisible = () =>
      typeof document === "undefined" ? true : document.visibilityState === "visible";

    const clearTimer = () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const schedule = (delayMs: number) => {
      clearTimer();
      pollTimerRef.current = setTimeout(async () => {
        if (cancelled) return;
        if (!isVisible()) {
          // Back off more when tab isn't visible
          pollDelayRef.current = Math.min(60_000, Math.max(5_000, pollDelayRef.current * 2));
          schedule(pollDelayRef.current);
          return;
        }

        try {
          const res = await getProjectSyncStatus(projectId);
          if (!res.success) {
            setSyncPollError(res.error || "Unable to check sync status. Retrying...");
            pollDelayRef.current = Math.min(30_000, Math.round(pollDelayRef.current * 1.5));
            return;
          }
          if (res.success && res.status) {
            if (res.status !== syncState) {
              // Reset backoff on state change
              pollDelayRef.current = 3000;
              setSyncState(res.status);
              if (res.status === "ready") {
                router.refresh();
              }
            } else {
              // Exponential-ish backoff while status is unchanged
              pollDelayRef.current = Math.min(30_000, Math.round(pollDelayRef.current * 1.5));
            }
            if (res.lastError) setSyncErrorReason(res.lastError);
            setSyncPollError(null);
          }
        } catch (e) {
          // Back off on error
          setSyncPollError("Unable to check sync status. Retrying...");
          pollDelayRef.current = Math.min(30_000, Math.round(pollDelayRef.current * 1.5));
        } finally {
          if (!cancelled && syncState !== "ready" && syncState !== "failed") {
            schedule(pollDelayRef.current);
          }
        }
      }, delayMs);
    };

    if (syncState === "ready" || syncState === "failed") {
      overlayStartedAtRef.current = null;
      pollDelayRef.current = 3000;
      clearTimer();
      setSyncPollError(null);
      // Fetch error reason once if failed
      if (syncState === "failed" && !syncErrorReason) {
        getProjectSyncStatus(projectId).then((res) => {
          if (res.success && res.lastError) setSyncErrorReason(res.lastError);
        });
      }
      return () => {
        cancelled = true;
        clearTimer();
      };
    }

    if (!overlayStartedAtRef.current) overlayStartedAtRef.current = Date.now();
    schedule(0);

    const onVisibility = () => {
      if (isVisible()) {
        pollDelayRef.current = 3000;
        schedule(0);
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      clearTimer();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [projectId, syncState, router, syncErrorReason]);

  // Manual refresh handler
  const handleManualRefresh = useCallback(async () => {
    setRetryLoading(true);
    pollDelayRef.current = 3000;
    try {
        const res = await getProjectSyncStatus(projectId);
        if (res.success && res.status) {
            setSyncState(res.status);
            if (res.lastError) setSyncErrorReason(res.lastError);
            if (res.status === 'ready') {
                router.refresh();
                showToast("Project is ready!", "success");
            } else {
                showToast(`Current status: ${res.status}`, "info");
            }
        }
    } finally {
        setRetryLoading(false);
    }
  }, [projectId, showToast, router]);

  const elapsedMs = overlayStartedAtRef.current ? Date.now() - overlayStartedAtRef.current : 0;
  const isSlow = elapsedMs > 90_000 && syncState !== 'ready' && syncState !== 'failed';
  const canRetryImport = (importSourceType === 'github') && canEdit;

  const handleRetryImport = useCallback(async () => {
    if (!canRetryImport) return;
    setRetryLoading(true);
    pollDelayRef.current = 3000;
    try {
      // Fetch fresh token from client session to ensure we have access
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.provider_token;

      const res = await retryGithubImportAction(projectId, token);
      if (!res.success) {
        showToast(res.error || "Retry failed", "error");
        return;
      }
      setSyncState("pending");
      setSyncPollError(null);
      overlayStartedAtRef.current = Date.now();
      showToast("Import retry started", "success");
    } finally {
      setRetryLoading(false);
    }
  }, [canRetryImport, projectId, showToast]);
  const ensureProjectWorkspace = useFilesWorkspaceStore((s) => s.ensureProjectWorkspace);
  const setNodes = useFilesWorkspaceStore((s) => s.setNodes);

  useEffect(() => {
    ensureProjectWorkspace(projectId);
    if (initialFileNodes && initialFileNodes.length > 0) {
        // Only set if we haven't loaded yet? Or always hydrate? 
        // Always hydrating ensures fresh server data.
        // We really should check if we already have data to avoid overwriting local optimistic updates if any.
        // But for initial load it's fine.
        const current = useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById;
        if (!current || Object.keys(current).length === 0) {
            setNodes(projectId, initialFileNodes);
        }
    }
  }, [ensureProjectWorkspace, projectId, initialFileNodes, setNodes]);

  // Granular selectors to avoid re-renders on every store update (e.g. file content changes)
  const leftOpenTabIds = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.panes.left.openTabIds || EMPTY_ARRAY);
  const rightOpenTabIds = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.panes.right.openTabIds || EMPTY_ARRAY);
  const leftActiveTabId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.panes.left.activeTabId);
  const rightActiveTabId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.panes.right.activeTabId);
  const splitEnabled = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.splitEnabled);
  const splitRatio = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.splitRatio ?? 0.5);
  const explorerMode = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.explorerMode || "tree");
  const viewMode = useFilesWorkspaceStore((s) => (s.byProjectId[projectId]?.viewMode as FilesViewMode) || "code");
  const nodesById = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.nodesById || DEFAULT_NODES);
  
  // Specific objects we need (excluding fileStates which changes too often)
  const panes = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.panes || DEFAULT_PANES);
  const prefs = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.prefs || DEFAULT_PREFS);
  const pinnedByTabId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.pinnedByTabId || DEFAULT_PINNED);
  
  const openTab = useFilesWorkspaceStore((s) => s.openTab);
  const closeTabStore = useFilesWorkspaceStore((s) => s.closeTab);
  const pinTab = useFilesWorkspaceStore((s) => s.pinTab);
  const closeOtherTabs = useFilesWorkspaceStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useFilesWorkspaceStore((s) => s.closeTabsToRight);
  const setSplitEnabled = useFilesWorkspaceStore((s) => s.setSplitEnabled);
  const setSplitRatio = useFilesWorkspaceStore((s) => s.setSplitRatio);
  const setPrefs = useFilesWorkspaceStore((s) => s.setPrefs);
  const removeNodeFromCaches = useFilesWorkspaceStore((s) => s.removeNodeFromCaches);
  const setViewMode = useFilesWorkspaceStore((s) => s.setViewMode);
  const setLock = useFilesWorkspaceStore((s) => s.setLock);
  const clearLock = useFilesWorkspaceStore((s) => s.clearLock);
  const setSelectedNode = useFilesWorkspaceStore((s) => s.setSelectedNode);
  const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);
  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);
  const setFileState = useFilesWorkspaceStore((s) => s.setFileState);
  const reorderTabs = useFilesWorkspaceStore((s) => s.reorderTabs);
  const moveTabToPane = useFilesWorkspaceStore((s) => s.moveTabToPane);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const state = useFilesWorkspaceStore.getState().byProjectId[projectId];
    if (!state) return;
    
    const findPane = (id: string) => {
      if (id === "left" || id === "right") return id;
      if (state.panes.left.openTabIds.includes(id)) return "left";
      if (state.panes.right.openTabIds.includes(id)) return "right";
      return null;
    };

    const activePane = findPane(active.id as string);
    const overPane = findPane(over.id as string);

    if (!activePane || !overPane) return;

    if (activePane === overPane) {
      const pane = state.panes[activePane];
      const oldIndex = pane.openTabIds.indexOf(active.id as string);
      const newIndex = pane.openTabIds.indexOf(over.id as string);
      if (oldIndex !== newIndex && newIndex !== -1) {
        reorderTabs(projectId, activePane as PaneId, arrayMove(pane.openTabIds, oldIndex, newIndex));
      }
    } else {
      const overIndex = state.panes[overPane].openTabIds.indexOf(over.id as string);
      moveTabToPane(projectId, activePane as PaneId, overPane as PaneId, active.id as string, overIndex);
    }
  }, [projectId, reorderTabs, moveTabToPane]);

  const [activePane, setActivePane] = useState<PaneId>("left");

  const [tabById, setTabById] = useState<Record<string, TabState>>({});
  const tabByIdRef = useRef<Record<string, TabState>>({});
  useEffect(() => {
    tabByIdRef.current = tabById;
  }, [tabById]);

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const getSupabase = useCallback(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }, []);

  const loadTokenRef = useRef<Map<string, number>>(new Map());
  const autosaveTimerRef = useRef<Record<PaneId, ReturnType<typeof setTimeout> | null>>({
    left: null,
    right: null,
  });
  const prevActiveRef = useRef<Record<PaneId, string | null>>({ left: null, right: null });

  const panesToRender: PaneId[] = splitEnabled ? ["left", "right"] : ["left"];

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findLoading, setFindLoading] = useState(false);
  const [findResults, setFindResults] = useState<Array<{ nodeId: string; snippet: string }>>([]);

  const failedLookupsRef = useRef<Set<string>>(new Set());
  const opsInProgressRef = useRef<Set<string>>(new Set());

  const ensureNodeMetadata = useCallback(
    async (nodeIds: string[]) => {
      if (nodeIds.length === 0) return;

      const state = useFilesWorkspaceStore.getState();
      const currentWs = state.byProjectId[projectId];
      if (!currentWs) return;
      
      // Filter out IDs that:
      // 1. Are already in the store
      // 2. Are known failures
      // 3. Are ALREADY being fetched (opsInProgress)
      const missing = nodeIds.filter((id) => 
        !currentWs.nodesById[id] && 
        !failedLookupsRef.current.has(id) &&
        !opsInProgressRef.current.has(`meta:${id}`)
      );
      
      if (missing.length === 0) return;

      // Mark as in-progress
      missing.forEach(id => opsInProgressRef.current.add(`meta:${id}`));
      
      try {
        const nodes = (await getNodesByIds(projectId, missing)) as ProjectNode[];
        
        // Track failed lookups
        const foundIds = new Set(nodes.map(n => n.id));
        missing.forEach(id => {
          if (!foundIds.has(id)) failedLookupsRef.current.add(id);
        });

        if (nodes.length > 0) {
          upsertNodes(projectId, nodes);
        }
      } finally {
        // Clear in-progress flag
        missing.forEach(id => opsInProgressRef.current.delete(`meta:${id}`));
      }
    },
    [projectId, upsertNodes] 
  );

  // Find-in-project shortcut: Ctrl/Cmd+Shift+F
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Find-in-project query
  useEffect(() => {
    if (!findOpen) return;
    const q = findQuery.trim();
    if (!q) {
      setFindResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setFindLoading(true);
      try {
        const results = await searchProjectFileIndex(projectId, q, 50);
        setFindResults(results as any);
        await ensureNodeMetadata((results as any).map((r: any) => r.nodeId));
      } finally {
        setFindLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [ensureNodeMetadata, findOpen, findQuery, projectId]);

  const loadFileContent = useCallback(
    async (node: ProjectNode) => {
      if (!node?.id || !node.s3Key) return;
      if (opsInProgressRef.current.has(node.id)) return; // Already loading
      
      opsInProgressRef.current.add(node.id);

      const nextToken = (loadTokenRef.current.get(node.id) || 0) + 1;
      loadTokenRef.current.set(node.id, nextToken);

      setTabById((prev) => ({
        ...prev,
        [node.id]: {
          ...(prev[node.id] ?? {
            id: node.id,
            node,
            content: "",
            savedSnapshot: "",
            isDirty: false,
            isLoading: true,
            isSaving: false,
            isDeleting: false,
            hasLock: false,
            lockInfo: null,
            offlineQueued: false,
            error: null,
          }),
          node,
          isLoading: true, // Optimistically true
          error: null,
        },
      }));

      // Check global cache first using getState() to avoid dependency on ws changes
      const state = useFilesWorkspaceStore.getState();
      const ws = state.byProjectId[projectId];
      const cached = ws?.fileStates?.[node.id];
      
      if (cached) {
        setTabById((prev) => ({
          ...prev,
          [node.id]: {
            ...prev[node.id],
            content: cached.content,
            isDirty: cached.isDirty,
            lastSavedAt: cached.lastSavedAt,
            savedSnapshot: cached.content,
            isLoading: false,
          },
        }));
        if (cached.content || cached.isDirty) {
             opsInProgressRef.current.delete(node.id);
             return; 
        }
      }

      try {
        const url = await ensureSignedUrlForNode(node);
        if (!url) throw new Error("Failed to fetch file URL");
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to load file (${res.status})`);
        }
        const text = await res.text();
        const latestToken = loadTokenRef.current.get(node.id);
        if (latestToken !== nextToken) return;

        // Update global cache
        setFileState(projectId, node.id, { content: text, isDirty: false });

        setTabById((prev) => ({
          ...prev,
          [node.id]: {
            ...prev[node.id],
            node,
            content: text,
            savedSnapshot: text,
            isLoading: false,
            isDirty: false,
            error: null,
          },
        }));
      } catch (e: any) {
        const latestToken = loadTokenRef.current.get(node.id);
        if (latestToken !== nextToken) return;
        setTabById((prev) => ({
          ...prev,
          [node.id]: {
            ...prev[node.id],
            node,
            isLoading: false,
            error: e?.message || "Failed to load file content",
          },
        }));
      } finally {
        opsInProgressRef.current.delete(node.id);
      }
    },
    [ensureSignedUrlForNode, projectId, setFileState] // Removed "ws" dependency (implicit or explicit)
  );

  const signedUrlCacheRef = useRef<Map<string, { url: string; expiresAt: number }>>(new Map());

  const ensureSignedUrlForNode = useCallback(
    async (node: ProjectNode) => {
      if (!node?.id) return null;

      const cached = signedUrlCacheRef.current.get(node.id);
      const now = Date.now();
      if (cached && cached.expiresAt > now + 5_000) return cached.url;

      const ttlSeconds = 300;
      const res = (await getProjectFileSignedUrl(projectId, node.id, ttlSeconds)) as {
        url: string;
        expiresAt: number;
      };
      signedUrlCacheRef.current.set(node.id, { url: res.url, expiresAt: res.expiresAt });
      return res.url;
    },
    [projectId]
  );

  const acquireLockForNode = useCallback(
    async (node: ProjectNode) => {
      if (!currentUserId) return;
      try {
        const res = await acquireProjectNodeLock(projectId, node.id, 120);
        if ((res as any).ok) {
          setTabById((prev) => ({
            ...prev,
            [node.id]: { ...prev[node.id], hasLock: true, lockInfo: null },
          }));
          clearLock(projectId, node.id);
        } else {
          const lock = (res as any).lock as {
            lockedBy: string;
            lockedByName?: string | null;
            expiresAt: number;
          };
          setTabById((prev) => ({
            ...prev,
            [node.id]: { ...prev[node.id], hasLock: false, lockInfo: lock },
          }));
          setLock(projectId, {
            nodeId: node.id,
            lockedBy: lock.lockedBy,
            lockedByName: lock.lockedByName ?? null,
            expiresAt: lock.expiresAt,
          });
        }
      } catch {
        setTabById((prev) => ({
          ...prev,
          [node.id]: { ...prev[node.id], hasLock: false },
        }));
      }
    },
    [acquireProjectNodeLock, clearLock, currentUserId, projectId, setLock]
  );

  const openFileInPane = useCallback(
    async (node: ProjectNode, paneId?: PaneId) => {
      if (!node || node.type !== "file") return;
      const targetPane = paneId ?? activePane;

      setActivePane(targetPane);
      openTab(projectId, targetPane, node.id);
      setSelectedNode(projectId, node.id, node.parentId ?? null);

      const wantsPreview =
        isAssetLike(node) && (viewMode === "assets" || viewMode === "all" || (viewMode === "code" && !isTextLike(node)));

      const existing = tabByIdRef.current[node.id];
      if (!existing) {
        setTabById((prev) => ({
          ...prev,
          [node.id]: {
            id: node.id,
            node,
            content: "",
            savedSnapshot: "",
            isDirty: false,
            isLoading: true,
            isSaving: false,
            isDeleting: false,
            hasLock: false,
            lockInfo: null,
            offlineQueued: false,
            error: null,
            assetUrl: null,
            assetUrlExpiresAt: null,
          },
        }));
      } else {
        // Keep metadata fresh
        setTabById((prev) => ({ ...prev, [node.id]: { ...prev[node.id], node } }));
      }

      if (wantsPreview) {
        const now = Date.now();
        const canReuse =
          existing?.assetUrl &&
          (existing.assetUrlExpiresAt ?? 0) > now + 5_000;
        if (!canReuse) {
          setTabById((prev) => ({ ...prev, [node.id]: { ...prev[node.id], isLoading: true, error: null } }));
          try {
            const url = await ensureSignedUrlForNode(node);
            const exp = signedUrlCacheRef.current.get(node.id)?.expiresAt ?? null;
            setTabById((prev) => ({
              ...prev,
              [node.id]: {
                ...prev[node.id],
                node,
                isLoading: false,
                assetUrl: url,
                assetUrlExpiresAt: exp,
              },
            }));
          } catch (e: any) {
            setTabById((prev) => ({
              ...prev,
              [node.id]: {
                ...prev[node.id],
                node,
                isLoading: false,
                error: e?.message || "Failed to load preview",
              },
            }));
          }
        }
      } else {
        // Editor path (text/code or "All" mode selecting text-like)
        if (!existing || (!existing.content && !existing.isDirty)) {
          await loadFileContent(node);
        }
      }

      if (canEdit) {
        await acquireLockForNode(node);
      }
    },
    [acquireLockForNode, activePane, canEdit, ensureSignedUrlForNode, loadFileContent, openTab, projectId, setSelectedNode, viewMode]
  );

  const saveTab = useCallback(
    async (nodeId: string, opts?: { silent?: boolean; reason?: string }): Promise<boolean> => {
      if (!canEdit) return false;
      const tab = tabByIdRef.current[nodeId];
      if (!tab) return false;
      if (!tab.node?.s3Key) return false;
      if (!tab.isDirty) return true;
      if (tab.isSaving) return false;
      if (!tab.hasLock) return false;

      // Offline queue
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setTabById((prev) => ({
          ...prev,
          [nodeId]: { ...prev[nodeId], offlineQueued: true },
        }));
        try {
          const key = `files-offline-queue:${projectId}`;
          const raw = localStorage.getItem(key);
          const queue = raw ? JSON.parse(raw) : {};
          queue[nodeId] = { content: tab.content, ts: Date.now() };
          localStorage.setItem(key, JSON.stringify(queue));
        } catch {}
        if (!opts?.silent) showToast("Offline: changes queued", "success");
        return true;
      }

      setTabById((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], isSaving: true } }));

      try {
        const supabase = getSupabase();
        const blob = new Blob([tab.content], { type: tab.node.mimeType || "text/plain" });
        const { error } = await supabase.storage
          .from("project-files")
          .update(tab.node.s3Key, blob, { upsert: true });
        if (error) throw error;

        // Calculate size in bytes
        const size = new TextEncoder().encode(tab.content).length;

        // Update metadata in DB
        await updateProjectFileStats(projectId, nodeId, size);
        
        // Update local node store immediately
        upsertNodes(projectId, [{ ...tab.node, size }]);

        // Update search index for text-like files (best-effort)
        try {
          const ext = tab.node.name.split(".").pop()?.toLowerCase();
          const isText =
            (tab.node.mimeType || "").startsWith("text/") ||
            ["ts", "tsx", "js", "jsx", "json", "md", "css", "html", "sql", "py", "txt"].includes(
              ext || ""
            );
          if (isText) {
            await upsertProjectFileIndex(projectId, tab.node.id, tab.content);
          }
        } catch {
          // ignore indexing failures (search will be best-effort)
        }

        const savedAt = Date.now();
        setFileState(projectId, nodeId, { isDirty: false, lastSavedAt: savedAt });
        setTabById((prev) => ({
          ...prev,
          [nodeId]: { ...prev[nodeId], isSaving: false, isDirty: false, offlineQueued: false, lastSavedAt: savedAt },
        }));
        setTabById((prev) => ({
          ...prev,
          [nodeId]: { ...prev[nodeId], savedSnapshot: prev[nodeId].content },
        }));
        try {
          const key = `files-offline-queue:${projectId}`;
          const raw = localStorage.getItem(key);
          if (raw) {
            const queue = JSON.parse(raw);
            delete queue[nodeId];
            localStorage.setItem(key, JSON.stringify(queue));
          }
        } catch {}
        try {
          await recordProjectNodeEvent(projectId, nodeId, "save", {
            bytes: tab.content.length,
          });
        } catch {}
        if (!opts?.silent) showToast("File saved", "success");
        return true;
      } catch (e: any) {
        setTabById((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], isSaving: false } }));
        if (!opts?.silent) showToast(`Failed to save: ${e?.message || "Unknown error"}`, "error");
        return false;
      }
    },
    [canEdit, getSupabase, projectId, recordProjectNodeEvent, setFileState, showToast, updateProjectFileStats, upsertNodes, upsertProjectFileIndex]
  );

  const saveContentDirect = useCallback(
    async (
      node: ProjectNode,
      content: string,
      opts?: { silent?: boolean; reason?: string }
    ): Promise<boolean> => {
      if (!canEdit) return false;
      if (!node?.id || !node.s3Key) return false;

      try {
        const supabase = getSupabase();
        const blob = new Blob([content], { type: node.mimeType || "text/plain" });
        const { error } = await supabase.storage
          .from("project-files")
          .update(node.s3Key, blob, { upsert: true });
        if (error) throw error;

        const size = new TextEncoder().encode(content).length;
        await updateProjectFileStats(projectId, node.id, size);
        upsertNodes(projectId, [{ ...node, size }]);

        try {
          const ext = node.name.split(".").pop()?.toLowerCase();
          const isText =
            (node.mimeType || "").startsWith("text/") ||
            ["ts", "tsx", "js", "jsx", "json", "md", "css", "html", "sql", "py", "txt"].includes(
              ext || ""
            );
          if (isText) {
            await upsertProjectFileIndex(projectId, node.id, content);
          }
        } catch {}

        const savedAt = Date.now();
        setFileState(projectId, node.id, { isDirty: false, lastSavedAt: savedAt });
        setTabById((prev) => {
          if (!prev[node.id]) return prev;
          return {
            ...prev,
            [node.id]: {
              ...prev[node.id],
              content,
              savedSnapshot: content,
              isDirty: false,
              isSaving: false,
              offlineQueued: false,
              lastSavedAt: savedAt,
            },
          };
        });

        try {
          await recordProjectNodeEvent(projectId, node.id, "save", {
            bytes: content.length,
          });
        } catch {}

        if (!opts?.silent) showToast("File saved", "success");
        return true;
      } catch (e: any) {
        if (!opts?.silent) showToast(`Failed to save: ${e?.message || "Unknown error"}`, "error");
        return false;
      }
    },
    [canEdit, getSupabase, projectId, recordProjectNodeEvent, setFileState, showToast, updateProjectFileStats, upsertNodes, upsertProjectFileIndex]
  );

  const closeTab = useCallback(
    async (paneId: PaneId, nodeId: string) => {
      const tab = tabByIdRef.current[nodeId];
      if (tab?.isDirty && canEdit) {
        const ok = await saveTab(nodeId, { silent: true, reason: "close" });
        if (!ok) {
          showToast("Could not save changes; tab kept open.", "error");
          return;
        }
      }
      if (tab?.hasLock) {
        try {
          await releaseProjectNodeLock(projectId, nodeId);
        } catch {}
        clearLock(projectId, nodeId);
      }
      closeTabStore(projectId, paneId, nodeId);
    },
    [canEdit, clearLock, closeTabStore, projectId, releaseProjectNodeLock, saveTab, showToast]
  );

  const deleteFile = useCallback(
    async (nodeId: string) => {
      if (!canEdit) return;
      const tab = tabByIdRef.current[nodeId];
      if (!tab) return;

      setTabById((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], isDeleting: true } }));

      try {
        await trashNode(nodeId, projectId);
        removeNodeFromCaches(projectId, nodeId);
        if (tab.hasLock) {
          try {
            await releaseProjectNodeLock(projectId, nodeId);
          } catch {}
          clearLock(projectId, nodeId);
        }
        setTabById((prev) => {
          const next = { ...prev };
          delete next[nodeId];
          return next;
        });
        showToast("Moved to Trash", "success");
      } catch (e: any) {
        setTabById((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], isDeleting: false } }));
        showToast(`Failed to delete file: ${e?.message || "Unknown error"}`, "error");
      }
    },
    [canEdit, clearLock, projectId, releaseProjectNodeLock, removeNodeFromCaches, showToast]
  );

  const flushOfflineQueue = useCallback(async () => {
    if (!canEdit) return;
    if (typeof navigator === "undefined" || !navigator.onLine) return;
    const key = `files-offline-queue:${projectId}`;

    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const queue = JSON.parse(raw) as Record<string, { content: string; ts: number }>;
      const nodeIds = Object.keys(queue);
      if (nodeIds.length === 0) return;

      showToast(`Syncing ${nodeIds.length} offline changes...`, "info");

      await ensureNodeMetadata(nodeIds);
      const currentWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
      if (!currentWs) return;

      let synced = 0;
      const nextQueue: Record<string, { content: string; ts: number }> = { ...queue };

      for (const nodeId of nodeIds) {
        const node = currentWs.nodesById[nodeId];
        if (!node?.s3Key) continue;

        try {
          const lockRes = await acquireProjectNodeLock(projectId, nodeId, 120);
          if (!(lockRes as any)?.ok) continue;

          const ok = await saveContentDirect(node, queue[nodeId].content, { silent: true, reason: "offline-flush" });
          if (ok) {
            delete nextQueue[nodeId];
            synced++;
          }
        } catch (e) {
          console.error("Offline sync failed for node", nodeId, e);
        } finally {
          try {
            await releaseProjectNodeLock(projectId, nodeId);
          } catch {}
        }
      }

      if (Object.keys(nextQueue).length === 0) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(nextQueue));
      }

      if (synced > 0) {
        showToast(`Synced ${synced} files from offline session`, "success");
      }
    } catch (e) {
      console.error("Offline sync failed", e);
    }
  }, [canEdit, projectId, ensureNodeMetadata, showToast, saveContentDirect, acquireProjectNodeLock, releaseProjectNodeLock]);

  useEffect(() => {
    const onOnline = () => {
      void flushOfflineQueue();
    };

    window.addEventListener("online", onOnline);
    void flushOfflineQueue();

    return () => window.removeEventListener("online", onOnline);
  }, [flushOfflineQueue]);

  // Restore / ensure metadata + content for persisted tabs
  // Restore / ensure metadata + content for persisted tabs
  useEffect(() => {
    const allOpenIds = Array.from(
      new Set([...leftOpenTabIds, ...rightOpenTabIds])
    );
    if (allOpenIds.length === 0) return;

    void (async () => {
      // 1. Metadata
      await ensureNodeMetadata(allOpenIds);
      
      // 2. Content
      // Use getState() to get the freshest nodes (metadata might have just been loaded)
      const currentWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
      if (!currentWs) return;

      for (const id of allOpenIds) {
        const node = currentWs.nodesById[id];
        if (!node) continue;
        
        if (!tabByIdRef.current[id]) {
          setTabById((prev) => ({
            ...prev,
            [id]: {
              id,
              node,
              content: "",
              savedSnapshot: "",
              isDirty: false,
              isLoading: true,
              isSaving: false,
              isDeleting: false,
              hasLock: false,
              lockInfo: null,
              offlineQueued: false,
              error: null,
              assetUrl: null,
              assetUrlExpiresAt: null,
            },
          }));
          const wantsPreview =
            isAssetLike(node) && (viewMode === "assets" || viewMode === "all" || (viewMode === "code" && !isTextLike(node)));
          if (wantsPreview) {
            try {
              const url = await ensureSignedUrlForNode(node);
              const exp = signedUrlCacheRef.current.get(node.id)?.expiresAt ?? null;
              setTabById((prev) => ({
                ...prev,
                [id]: { ...prev[id], isLoading: false, assetUrl: url, assetUrlExpiresAt: exp },
              }));
            } catch (e: any) {
              setTabById((prev) => ({
                ...prev,
                [id]: { ...prev[id], isLoading: false, error: e?.message || "Failed to load preview" },
              }));
            }
          } else {
            await loadFileContent(node);
          }
        }
      }
    })();
    // Dependencies are now just the ID lists (strings). 
    // We intentionally exclude 'ensureNodeMetadata' and 'loadFileContent' if they are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, leftOpenTabIds.join(","), rightOpenTabIds.join(","), viewMode]);

  // Save previous active tab on switch, per pane (best-effort)
  useEffect(() => {
    for (const paneId of panesToRender) {
      const prev = prevActiveRef.current[paneId];
      const current = panes[paneId]?.activeTabId;
      if (prev && prev !== current) {
        const prevTab = tabByIdRef.current[prev];
        if (prevTab?.isDirty && canEdit) void saveTab(prev, { silent: true, reason: "switch" });
      }
      prevActiveRef.current[paneId] = current;
    }
  }, [canEdit, panesToRender, saveTab, panes.left?.activeTabId, panes.right?.activeTabId]);

  // Ensure active tabs attempt to acquire a lock
  useEffect(() => {
    if (!currentUserId) return;
    for (const paneId of panesToRender) {
      const id = panes[paneId]?.activeTabId;
      if (!id) continue;
      const tab = tabById[id];
      if (!tab) continue;
      if (tab.hasLock) continue;
      if (!canEdit) continue;
      void acquireLockForNode(tab.node);
    }
  }, [acquireLockForNode, canEdit, currentUserId, panesToRender, tabById, panes.left?.activeTabId, panes.right?.activeTabId]);

  // Debounced autosave per pane active tab
  useEffect(() => {
    for (const paneId of panesToRender) {
      if (autosaveTimerRef.current[paneId]) clearTimeout(autosaveTimerRef.current[paneId]!);
      const id = panes[paneId]?.activeTabId;
      if (!id || !canEdit) continue;
      const tab = tabById[id];
      if (!tab || !tab.isDirty || tab.isSaving) continue;

      autosaveTimerRef.current[paneId] = setTimeout(() => {
        void saveTab(id, { silent: true, reason: "autosave" });
      }, 1000);
    }
    return () => {
      for (const paneId of panesToRender) {
        if (autosaveTimerRef.current[paneId]) clearTimeout(autosaveTimerRef.current[paneId]!);
      }
    };
  }, [canEdit, panesToRender, saveTab, tabById, panes.left?.activeTabId, panes.right?.activeTabId]);

  // Keepalive for active locks
  useEffect(() => {
    if (!currentUserId) return;
    const interval = setInterval(() => {
      for (const paneId of panesToRender) {
        const id = panes[paneId]?.activeTabId;
        if (!id) continue;
        const tab = tabByIdRef.current[id];
        if (!tab?.hasLock) continue;
        void refreshProjectNodeLock(projectId, id, 120);
      }
    }, 45_000);
    return () => clearInterval(interval);
  }, [currentUserId, panesToRender, projectId, panes.left?.activeTabId, panes.right?.activeTabId]);

  const startResize = (e: React.MouseEvent) => {
    if (!splitEnabled) return;
    e.preventDefault();
    const startX = e.clientX;
    const startRatio = splitRatio;
    const container = (e.currentTarget as HTMLElement).parentElement;
    const width = container?.getBoundingClientRect().width || 1;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      setSplitRatio(projectId, startRatio + delta / width);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const nothingOpen =
    panes.left.openTabIds.length === 0 && (!splitEnabled || panes.right.openTabIds.length === 0);

  return (
    <div className="flex-1 w-full min-h-0 flex bg-white dark:bg-zinc-950 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm relative isolate">
      {/* Explorer */}
      <div className="w-[320px] flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col h-full bg-zinc-50/50 dark:bg-zinc-900/50 relative z-10">
        <FileExplorer
          projectId={projectId}
          projectName={projectName}
          canEdit={canEdit}
          viewMode={viewMode}
          onOpenFile={(node) => void openFileInPane(node)}
          onNodeDeleted={(nodeId) => removeNodeFromCaches(projectId, nodeId)}
          syncStatus={syncState}
        />
      </div>

      {/* Workspace */}
      <div className="flex-1 overflow-hidden bg-white dark:bg-zinc-950 flex flex-col h-full relative">
        <div
          className="absolute inset-0 z-0 pointer-events-none opacity-[0.03] dark:opacity-[0.05]"
          style={{
            backgroundImage: "radial-gradient(#6366f1 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative z-10 flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Editor
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8">
                  <Layers className="w-4 h-4 mr-2" />
                  View: {viewMode === "code" ? "Code" : viewMode === "assets" ? "Assets" : "All"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setViewMode(projectId, "code")}>Code</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setViewMode(projectId, "assets")}>Assets</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setViewMode(projectId, "all")}>All</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => setFindOpen(true)}
              title="Find in project (Ctrl/⌘+Shift+F)"
            >
              Find
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8">
                  <MoreVertical className="w-4 h-4 mr-2" />
                  Settings
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setPrefs(projectId, { lineNumbers: !prefs.lineNumbers })}
                >
                  {prefs.lineNumbers ? "Hide" : "Show"} line numbers
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setPrefs(projectId, { wordWrap: !prefs.wordWrap })}
                >
                  {prefs.wordWrap ? "Disable" : "Enable"} word wrap
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setPrefs(projectId, { minimap: !prefs.minimap })}
                >
                  {prefs.minimap ? "Hide" : "Show"} minimap
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setPrefs(projectId, { fontSize: Math.max(12, prefs.fontSize - 1) })}
                >
                  Font size: -
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setPrefs(projectId, { fontSize: Math.min(20, prefs.fontSize + 1) })}
                >
                  Font size: +
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => setSplitEnabled(projectId, !splitEnabled)}
            >
              <SplitSquareVertical className="w-4 h-4 mr-2" />
              {splitEnabled ? "Single" : "Split"}
            </Button>
          </div>
        </div>

        <div className="relative z-10 flex-1 overflow-hidden flex">
          <DndContext 
            sensors={sensors} 
            collisionDetection={closestCenter} 
            onDragEnd={handleDragEnd}
          >
            <Pane
              projectId={projectId}
            paneId="left"
            canEdit={canEdit}
            width={splitEnabled ? `${splitRatio * 100}%` : "100%"}
            tabIds={orderedTabIds(panes.left.openTabIds, pinnedByTabId)}
            activeTabId={panes.left.activeTabId}
            pinnedById={pinnedByTabId}
            tabById={tabById}
            prefs={prefs}
            setActivePane={() => setActivePane("left")}
            setActiveTab={(id) => useFilesWorkspaceStore.getState().setActiveTab(projectId, "left", id)}
            onCloseTab={(id) => void closeTab("left", id)}
            onPinTab={(id, pinned) => pinTab(projectId, "left", id, pinned)}
            onCloseOthers={(id) => closeOtherTabs(projectId, "left", id)}
            onCloseToRight={(id) => closeTabsToRight(projectId, "left", id)}
            onChange={(id, next) => {
              setFileState(projectId, id, { content: next, isDirty: true });
              setTabById((prev) => ({ ...prev, [id]: { ...prev[id], content: next, isDirty: true } }))
            }}
            onSave={(id) => void saveTab(id)}
            onRetryLoad={(id) => {
              const node = nodesById[id];
              if (node) void loadFileContent(node);
            }}
            onDelete={(id) => void deleteFile(id)}
            onCrumbClick={(folderId) => {
              setSelectedNode(projectId, folderId, folderId);
              toggleExpanded(projectId, folderId, true);
            }}
            onNavigatePathNode={(node) => void openFileInPane(node, "left")}
          />

          {splitEnabled ? (
            <div
              className="w-1 cursor-col-resize bg-zinc-200 dark:bg-zinc-800 hover:bg-indigo-300 dark:hover:bg-indigo-700 transition-colors"
              onMouseDown={startResize}
              aria-label="Resize split"
            />
          ) : null}

          {splitEnabled ? (
            <Pane
              projectId={projectId}
              paneId="right"
              canEdit={canEdit}
              width={`${(1 - splitRatio) * 100}%`}
              tabIds={orderedTabIds(panes.right.openTabIds, pinnedByTabId)}
              activeTabId={panes.right.activeTabId}
              pinnedById={pinnedByTabId}
              tabById={tabById}
            prefs={prefs}
              setActivePane={() => setActivePane("right")}
              setActiveTab={(id) => useFilesWorkspaceStore.getState().setActiveTab(projectId, "right", id)}
              onCloseTab={(id) => void closeTab("right", id)}
              onPinTab={(id, pinned) => pinTab(projectId, "right", id, pinned)}
              onCloseOthers={(id) => closeOtherTabs(projectId, "right", id)}
              onCloseToRight={(id) => closeTabsToRight(projectId, "right", id)}
              onChange={(id, next) => {
                setFileState(projectId, id, { content: next, isDirty: true });
                setTabById((prev) => ({ ...prev, [id]: { ...prev[id], content: next, isDirty: true } }))
              }}
              onSave={(id) => void saveTab(id)}
              onRetryLoad={(id) => {
                const node = nodesById[id];
                if (node) void loadFileContent(node);
              }}
              onDelete={(id) => void deleteFile(id)}
              onCrumbClick={(folderId) => {
                setSelectedNode(projectId, folderId, folderId);
                toggleExpanded(projectId, folderId, true);
              }}
              onNavigatePathNode={(node) => void openFileInPane(node, "right")}
            />
          ) : null}
          </DndContext>
        </div>

        {nothingOpen ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-zinc-400 p-8 bg-white dark:bg-zinc-950">
            <div className="w-24 h-24 rounded-[2rem] bg-gradient-to-tr from-zinc-100 to-zinc-50 dark:from-zinc-900 dark:to-zinc-800 flex items-center justify-center mb-6 shadow-xl shadow-zinc-100 dark:shadow-black/20 border border-white dark:border-zinc-700">
              <FileCode className="w-10 h-10 text-zinc-300 dark:text-zinc-600" />
            </div>
            <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
              Select a file to start
            </h3>
            <p className="text-zinc-500 max-w-md text-center mb-4">
              Use the explorer on the left to open or create files. Your recent files and favorites are one click away.
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
        ) : null}

        {/* Find in Project */}
        {findOpen ? (
          <div className="absolute inset-0 z-20 bg-black/30 flex items-center justify-center p-4">
            <div className="w-full max-w-3xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                <div className="text-sm font-semibold">Find in project</div>
                <button
                  className="p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  onClick={() => {
                    setFindOpen(false);
                    setFindQuery("");
                    setFindResults([]);
                  }}
                  aria-label="Close find"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <input
                  autoFocus
                  className="w-full h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm outline-none"
                  placeholder="Search text (indexed on save)…"
                  value={findQuery}
                  onChange={(e) => setFindQuery(e.target.value)}
                />
                <div className="max-h-[50vh] overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                  {findLoading ? (
                    <div className="p-3 text-sm text-zinc-500">Searching…</div>
                  ) : findResults.length === 0 ? (
                    <div className="p-3 text-sm text-zinc-500">No results</div>
                  ) : (
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {findResults.map((r) => {
                        const node = nodesById[r.nodeId];
                        return (
                          <button
                            key={r.nodeId}
                            className="w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                            onClick={() => {
                              if (!node) return;
                              setFindOpen(false);
                              setFindQuery("");
                              setFindResults([]);
                              void openFileInPane(node, activePane);
                            }}
                          >
                            <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                              {node?.name || r.nodeId}
                            </div>
                            <div className="text-xs text-zinc-500 font-mono whitespace-pre-wrap break-words mt-1">
                              {r.snippet}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="text-xs text-zinc-400">
                  Note: results include files that have been saved at least once (indexed on save).
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {/* Syncing Overlay */}
      {showOverlay && (
          <div className="absolute inset-0 z-50 bg-white/95 dark:bg-zinc-950/95 flex flex-col items-center justify-center p-8 backdrop-blur-sm animate-in fade-in duration-300">
              <div className="flex flex-col items-center max-w-md text-center space-y-6">
                  <div className="w-20 h-20 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center relative">
                      {syncState === 'failed' ? (
                          <RefreshCw className="w-10 h-10 text-red-500" />
                      ) : (
                          <>
                              <div className="absolute inset-0 rounded-2xl border-2 border-indigo-500/20 animate-ping" />
                              <Loader2 className="w-10 h-10 text-indigo-600 dark:text-indigo-400 animate-spin" />
                          </>
                      )}
                  </div>
                  
                  <div className="space-y-2">
                    <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                        {syncState === 'cloning' ? 'Importing Repository...' :
                         syncState === 'indexing' ? 'Indexing Files...' :
                         syncState === 'pending' ? 'Queued for Import...' :
                         'Import Failed'}
                    </h3>
                    <p className="text-zinc-500 dark:text-zinc-400">
                        {syncState === 'failed' 
                            ? (syncErrorReason || "We couldn't import your project. Please try again or check the repository URL.")
                            : "We're setting up your workspace. This usually takes less than a minute."}
                    </p>
                    {syncPollError && (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        {syncPollError}
                      </p>
                    )}
                    {isSlow && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Taking longer than usual? Try refreshing the status.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-3 w-full max-w-xs">
                     {syncState === 'failed' || isSlow ? (
                        canRetryImport ? (
                          <Button onClick={handleRetryImport} disabled={retryLoading} className="w-full">
                            {retryLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                            Retry GitHub Import
                          </Button>
                        ) : (
                          <Button onClick={() => window.location.reload()} variant="outline" className="w-full">
                            Reload Page
                          </Button>
                        )
                     ) : null}
                     
                     {syncState !== 'failed' && (
                         <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={handleManualRefresh}
                            disabled={retryLoading}
                            className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                        >
                            {retryLoading ? 'Checking...' : 'Check Status Again'}
                        </Button>
                     )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}

function Pane({
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
}: {
  projectId: string;
  paneId: PaneId;
  canEdit: boolean;
  width: string;
  tabIds: string[];
  activeTabId: string | null;
  pinnedById: Record<string, boolean>;
  tabById: Record<string, TabState>;
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
}) {
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
            <AssetPreview node={activeTab.node} signedUrl={activeTab.assetUrl} />
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
