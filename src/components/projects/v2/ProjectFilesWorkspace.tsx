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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  DndContext,
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
  Play,
  Search,
  TerminalSquare,
  X,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  recordProjectNodeEvent,
  trashNode,
  acquireProjectNodeLock,
  findNodeByPathAny,
  getNodesByIds,
  applyProjectSearchReplace,
  refreshProjectNodeLock,
  rollbackProjectSearchReplace,
  releaseProjectNodeLock,
  previewProjectSearchReplace,
  searchProjectFileIndex,
  upsertProjectFileIndex,
  updateProjectFileStats,
  getProjectFileSignedUrl,
} from "@/app/actions/files";
import { getProjectSyncStatus, retryGithubImportAction } from "@/app/actions/project";
import {
  getProjectRunProfilesAction,
  getProjectRunSessionDetailAction,
  listProjectRunSessionsAction,
  runProjectProfileAction,
} from "@/app/actions/runner";
import { useRouter } from "next/navigation";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { BreadcrumbBar } from "./navigation/BreadcrumbBar";
import type { FilesViewMode } from "@/stores/filesWorkspaceStore";
import { isAssetLike, isTextLike } from "./utils/fileKind";
import AssetPreview from "./preview/AssetPreview";
import RunnerPanel from "./runner/RunnerPanel";
import type { PersistedRunSessionDetail, RunnerProfileRecord, RunnerSessionRecord } from "@/lib/runner/contracts";
import { isNoOpSave, resolvePostSaveState } from "@/lib/files/save-logic";

const EMPTY_ARRAY: string[] = [];

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
const LOCK_RETRY_FALLBACK_MS = 5_000;
const LOCK_RETRY_MIN_DELAY_MS = 1_000;
const LOCK_RETRY_EXPIRY_BUFFER_MS = 250;

type PaneId = "left" | "right";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type NodeLockResult = {
  ok: boolean;
  lock?: {
    lockedBy: string;
    lockedByName?: string | null;
    expiresAt: number;
  };
};

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
        } catch {
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
      const res = await retryGithubImportAction(projectId);
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
  const viewMode = useFilesWorkspaceStore((s) => (s.byProjectId[projectId]?.viewMode as FilesViewMode) || "code");
  const nodesById = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.nodesById || DEFAULT_NODES);
  
  // Specific objects we need (excluding fileStates which changes too often)
  const panes = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.panes || DEFAULT_PANES);
  const prefs = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.prefs || DEFAULT_PREFS);
  const pinnedByTabId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.pinnedByTabId || DEFAULT_PINNED);
  const activeTabIdByPane = useMemo<Record<PaneId, string | null>>(
    () => ({
      left: leftActiveTabId ?? null,
      right: rightActiveTabId ?? null,
    }),
    [leftActiveTabId, rightActiveTabId]
  );
  
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
  const lastServerVersionCheckRef = useRef<Map<string, number>>(new Map());
  const nextLockAttemptAtRef = useRef<Map<string, number>>(new Map());
  const inFlightSaveByNodeRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const runnerRefreshInFlightRef = useRef<Promise<boolean> | null>(null);
  const lastRunnerRefreshAtRef = useRef(0);
  const runnerDetailCacheRef = useRef<Map<string, PersistedRunSessionDetail>>(new Map());
  const runSequenceRef = useRef(0);
  const autosaveTimerRef = useRef<Record<PaneId, ReturnType<typeof setTimeout> | null>>({
    left: null,
    right: null,
  });
  const prevActiveRef = useRef<Record<PaneId, string | null>>({ left: null, right: null });

  const panesToRender = useMemo<PaneId[]>(
    () => (splitEnabled ? ["left", "right"] : ["left"]),
    [splitEnabled]
  );
  const leftOpenTabIdsKey = useMemo(() => leftOpenTabIds.join(","), [leftOpenTabIds]);
  const rightOpenTabIdsKey = useMemo(() => rightOpenTabIds.join(","), [rightOpenTabIds]);
  const leftActiveTab = activeTabIdByPane.left ? tabById[activeTabIdByPane.left] : null;
  const rightActiveTab = activeTabIdByPane.right ? tabById[activeTabIdByPane.right] : null;

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [headerSearchOpen, setHeaderSearchOpen] = useState(false);
  const [headerSearchQuery, setHeaderSearchQuery] = useState("");
  const [findLoading, setFindLoading] = useState(false);
  const [findResults, setFindResults] = useState<Array<{ nodeId: string; snippet: string }>>([]);
  const [replacePreviewLoading, setReplacePreviewLoading] = useState(false);
  const [replaceApplying, setReplaceApplying] = useState(false);
  const [replacePreviewItems, setReplacePreviewItems] = useState<
    Array<{
      nodeId: string;
      name: string;
      parentId: string | null;
      occurrenceCount: number;
      beforeSnippet: string;
      afterSnippet: string;
    }>
  >([]);
  const [selectedReplaceNodeIds, setSelectedReplaceNodeIds] = useState<string[]>([]);
  const [lastReplaceBackup, setLastReplaceBackup] = useState<Array<{ nodeId: string; content: string }>>([]);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [recentFileIds, setRecentFileIds] = useState<string[]>([]);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [runnerLoading, setRunnerLoading] = useState(false);
  const [runnerProfiles, setRunnerProfiles] = useState<RunnerProfileRecord[]>([]);
  const [selectedRunnerProfileId, setSelectedRunnerProfileId] = useState<string | null>(null);
  const [runnerSessions, setRunnerSessions] = useState<RunnerSessionRecord[]>([]);
  const [activeRunnerSessionId, setActiveRunnerSessionId] = useState<string | null>(null);
  const [activeRunnerDetail, setActiveRunnerDetail] = useState<PersistedRunSessionDetail | null>(null);

  const failedLookupsRef = useRef<Set<string>>(new Set());
  const opsInProgressRef = useRef<Set<string>>(new Set());

  const fileNodes = useMemo(
    () => Object.values(nodesById).filter((node) => node?.type === "file"),
    [nodesById]
  );

  const nodePathById = useMemo(() => {
    const cache = new Map<string, string>();
    const resolve = (nodeId: string): string => {
      const cached = cache.get(nodeId);
      if (cached) return cached;
      const node = nodesById[nodeId];
      if (!node) return "";
      if (!node.parentId) {
        cache.set(nodeId, node.name);
        return node.name;
      }
      const path = `${resolve(node.parentId)}/${node.name}`;
      cache.set(nodeId, path);
      return path;
    };
    for (const node of Object.values(nodesById)) {
      if (node?.id) resolve(node.id);
    }
    return cache;
  }, [nodesById]);

  const quickOpenResults = useMemo(() => {
    const rawQuery = quickOpenQuery.trim().toLowerCase();
    if (!rawQuery) {
      const recent = recentFileIds
        .map((id) => nodesById[id])
        .filter((node): node is ProjectNode => !!node && node.type === "file");
      if (recent.length > 0) return recent.slice(0, 40);
      return fileNodes.slice(0, 40);
    }
    const scored = fileNodes
      .map((node) => {
        const name = node.name.toLowerCase();
        const path = (nodePathById.get(node.id) || node.name).toLowerCase();
        let score = 0;
        if (name === rawQuery) score += 500;
        if (name.startsWith(rawQuery)) score += 300;
        if (name.includes(rawQuery)) score += 180;
        if (path.includes(rawQuery)) score += 120;
        if (score === 0) return null;
        return { node, score };
      })
      .filter((item): item is { node: ProjectNode; score: number } => !!item)
      .sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name));
    return scored.slice(0, 50).map((item) => item.node);
  }, [fileNodes, nodesById, nodePathById, quickOpenQuery, recentFileIds]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`files-recent-open:${projectId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecentFileIds(parsed.filter((id): id is string => typeof id === "string").slice(0, 50));
      }
    } catch {}
  }, [projectId]);

  useEffect(() => {
    try {
      localStorage.setItem(`files-recent-open:${projectId}`, JSON.stringify(recentFileIds.slice(0, 50)));
    } catch {}
  }, [projectId, recentFileIds]);

  const refreshRunnerSessions = useCallback(
    async (preferredSessionId?: string | null, opts?: { force?: boolean }) => {
      const now = Date.now();
      if (!opts?.force && runnerRefreshInFlightRef.current) {
        return runnerRefreshInFlightRef.current;
      }
      if (!opts?.force && now - lastRunnerRefreshAtRef.current < 400) {
        return true;
      }

      const task = (async () => {
        const sessionsRes = await listProjectRunSessionsAction(projectId, 40);
        if (!sessionsRes.success) return false;

        lastRunnerRefreshAtRef.current = Date.now();
        setRunnerSessions(sessionsRes.sessions);

        const existingIds = new Set(sessionsRes.sessions.map((session) => session.id));
        for (const key of Array.from(runnerDetailCacheRef.current.keys())) {
          if (!existingIds.has(key)) runnerDetailCacheRef.current.delete(key);
        }

        setActiveRunnerSessionId((prev) => {
          const persisted =
            typeof window !== "undefined"
              ? window.localStorage.getItem(`files-runner-active-session:${projectId}`)
              : null;
          const candidate = preferredSessionId ?? prev ?? persisted;
          if (candidate && sessionsRes.sessions.some((session) => session.id === candidate)) {
            return candidate;
          }
          return sessionsRes.sessions[0]?.id ?? null;
        });
        return true;
      })();

      runnerRefreshInFlightRef.current = task;
      try {
        return await task;
      } finally {
        runnerRefreshInFlightRef.current = null;
      }
    },
    [projectId]
  );

  useEffect(() => {
    let cancelled = false;
    const loadRunnerBootstrap = async () => {
      const [profilesRes] = await Promise.all([
        getProjectRunProfilesAction(projectId),
      ]);
      if (cancelled) return;
      if (profilesRes.success) {
        setRunnerProfiles(profilesRes.profiles);
        setSelectedRunnerProfileId((prev) => {
          if (prev && profilesRes.profiles.some((profile) => profile.id === prev)) return prev;
          return profilesRes.profiles.find((profile) => profile.isDefault)?.id ?? profilesRes.profiles[0]?.id ?? null;
        });
      } else {
        setRunnerProfiles([]);
        setSelectedRunnerProfileId(null);
      }

      const persistedSessionId =
        typeof window !== "undefined"
          ? window.localStorage.getItem(`files-runner-active-session:${projectId}`)
          : null;
      await refreshRunnerSessions(persistedSessionId, { force: true });
    };
    void loadRunnerBootstrap();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshRunnerSessions]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`files-runner-open:${projectId}`);
      if (raw === "1") setRunnerOpen(true);
      if (raw === "0") setRunnerOpen(false);
    } catch {}
  }, [projectId]);

  useEffect(() => {
    try {
      localStorage.setItem(`files-runner-open:${projectId}`, runnerOpen ? "1" : "0");
    } catch {}
  }, [projectId, runnerOpen]);

  useEffect(() => {
    if (!activeRunnerSessionId) return;
    try {
      localStorage.setItem(`files-runner-active-session:${projectId}`, activeRunnerSessionId);
    } catch {}
  }, [activeRunnerSessionId, projectId]);

  useEffect(() => {
    if (!activeRunnerSessionId) {
      setActiveRunnerDetail(null);
      return;
    }

    const cached = runnerDetailCacheRef.current.get(activeRunnerSessionId);
    if (cached) {
      setActiveRunnerDetail(cached);
      return;
    }

    let cancelled = false;
    const loadDetail = async () => {
      const detailRes = await getProjectRunSessionDetailAction(projectId, activeRunnerSessionId);
      if (cancelled) return;
      if (detailRes.success) {
        runnerDetailCacheRef.current.set(activeRunnerSessionId, detailRes.detail);
        setActiveRunnerDetail(detailRes.detail);
      } else {
        setActiveRunnerDetail(null);
      }
    };
    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [activeRunnerSessionId, projectId]);

  const runSelectedProfile = useCallback(async () => {
    if (runnerLoading) return;
    const runSequence = ++runSequenceRef.current;
    setRunnerLoading(true);
    setRunnerOpen(true);
    try {
      const runRes = await runProjectProfileAction(projectId, {
        profileId: selectedRunnerProfileId || undefined,
      });
      if (runSequenceRef.current !== runSequence) return;
      if (!runRes.success) {
        showToast(runRes.error || "Run failed", "error");
        return;
      }
      runnerDetailCacheRef.current.set(runRes.detail.session.id, runRes.detail);
      setActiveRunnerDetail(runRes.detail);
      setActiveRunnerSessionId(runRes.detail.session.id);
      await refreshRunnerSessions(runRes.detail.session.id, { force: true });
      showToast(
        runRes.detail.session.status === "failed"
          ? "Run completed with errors"
          : "Run completed",
        runRes.detail.session.status === "failed" ? "error" : "success"
      );
    } finally {
      if (runSequenceRef.current === runSequence) {
        setRunnerLoading(false);
      }
    }
  }, [projectId, refreshRunnerSessions, runnerLoading, selectedRunnerProfileId, showToast]);

  const commandActions = useMemo(
    () =>
      [
        {
          id: "find",
          label: "Find in Project",
          run: () => {
            setFindOpen(true);
          },
        },
        {
          id: "view-code",
          label: "Set View: Code",
          run: () => setViewMode(projectId, "code"),
        },
        {
          id: "view-assets",
          label: "Set View: Assets",
          run: () => setViewMode(projectId, "assets"),
        },
        {
          id: "view-all",
          label: "Set View: All",
          run: () => setViewMode(projectId, "all"),
        },
        {
          id: "toggle-split",
          label: splitEnabled ? "Switch to Single Editor" : "Switch to Split Editor",
          run: () => setSplitEnabled(projectId, !splitEnabled),
        },
        {
          id: "toggle-runner",
          label: runnerOpen ? "Hide Runner Panel" : "Show Runner Panel",
          run: () => setRunnerOpen((prev) => !prev),
        },
        {
          id: "run-profile",
          label: "Run Selected Profile",
          run: () => {
            void runSelectedProfile();
          },
        },
      ] as Array<{ id: string; label: string; run: () => void }>,
    [projectId, runSelectedProfile, runnerOpen, setSplitEnabled, setViewMode, splitEnabled]
  );

  const filteredCommandActions = useMemo(() => {
    const q = commandQuery.trim().toLowerCase();
    if (!q) return commandActions;
    return commandActions.filter((action) => action.label.toLowerCase().includes(q));
  }, [commandActions, commandQuery]);

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
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setQuickOpenOpen(true);
        setQuickOpenQuery("");
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setCommandOpen(true);
        setCommandQuery("");
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

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (quickOpenOpen) setQuickOpenOpen(false);
      if (commandOpen) setCommandOpen(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [commandOpen, quickOpenOpen]);

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
        setFindResults(results);
        await ensureNodeMetadata(results.map((r) => r.nodeId));
      } finally {
        setFindLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [ensureNodeMetadata, findOpen, findQuery, projectId]);

  useEffect(() => {
    if (!findOpen) return;
    const q = findQuery.trim();
    if (!q || q.length < 2) {
      setReplacePreviewItems([]);
      setSelectedReplaceNodeIds([]);
      return;
    }
    const t = setTimeout(async () => {
      setReplacePreviewLoading(true);
      try {
        const res = await previewProjectSearchReplace(projectId, q, replaceQuery, 80);
        if (res.success) {
          setReplacePreviewItems(res.items);
          const validIds = new Set(res.items.map((item) => item.nodeId));
          setSelectedReplaceNodeIds((prev) => {
            const kept = prev.filter((id) => validIds.has(id));
            return kept.length > 0 ? kept : res.items.map((item) => item.nodeId);
          });
          await ensureNodeMetadata(res.items.map((item) => item.nodeId));
        } else {
          setReplacePreviewItems([]);
          setSelectedReplaceNodeIds([]);
        }
      } finally {
        setReplacePreviewLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [ensureNodeMetadata, findOpen, findQuery, projectId, replaceQuery]);

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
        if (cached.content !== undefined || cached.isDirty) {
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
      } catch (e: unknown) {
        const latestToken = loadTokenRef.current.get(node.id);
        if (latestToken !== nextToken) return;
        setTabById((prev) => ({
          ...prev,
          [node.id]: {
            ...prev[node.id],
            node,
            isLoading: false,
            error: getErrorMessage(e, "Failed to load file content"),
          },
        }));
      } finally {
        opsInProgressRef.current.delete(node.id);
      }
    },
    [ensureSignedUrlForNode, projectId, setFileState] // Removed "ws" dependency (implicit or explicit)
  );

  const refreshFindReplaceData = useCallback(
    async (query: string, replacement: string) => {
      const trimmed = query.trim();
      if (!trimmed) {
        setFindResults([]);
        setReplacePreviewItems([]);
        setSelectedReplaceNodeIds([]);
        return;
      }
      const [findRows, previewRes] = await Promise.all([
        searchProjectFileIndex(projectId, trimmed, 50),
        previewProjectSearchReplace(projectId, trimmed, replacement, 80),
      ]);
      setFindResults(findRows as Array<{ nodeId: string; snippet: string }>);
      await ensureNodeMetadata((findRows as Array<{ nodeId: string; snippet: string }>).map((row) => row.nodeId));
      if (previewRes.success) {
        setReplacePreviewItems(previewRes.items);
        setSelectedReplaceNodeIds(previewRes.items.map((item) => item.nodeId));
      } else {
        setReplacePreviewItems([]);
        setSelectedReplaceNodeIds([]);
      }
    },
    [ensureNodeMetadata, projectId]
  );

  const handleApplyBatchReplace = useCallback(async () => {
    if (!canEdit) {
      showToast("Write access required", "error");
      return;
    }
    const q = findQuery.trim();
    if (q.length < 2) {
      showToast("Search query must be at least 2 characters", "error");
      return;
    }
    const nodeIds = Array.from(new Set(selectedReplaceNodeIds)).slice(0, 60);
    if (nodeIds.length === 0) {
      showToast("Select at least one file", "error");
      return;
    }

    setReplaceApplying(true);
    try {
      const res = await applyProjectSearchReplace(projectId, {
        query: q,
        replacement: replaceQuery,
        nodeIds,
      });
      if (!res.success) {
        showToast(res.error || "Replace failed", "error");
        return;
      }

      setLastReplaceBackup(res.backup || []);
      if ((res.changedNodeIds || []).length === 0) {
        showToast("No matches changed", "info");
        return;
      }

      await ensureNodeMetadata(res.changedNodeIds);
      for (const nodeId of res.changedNodeIds) {
        const tab = tabByIdRef.current[nodeId];
        if (tab?.isDirty) continue;
        const node = useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById?.[nodeId];
        if (node && node.type === "file") {
          await loadFileContent(node);
        }
      }

      await refreshFindReplaceData(q, replaceQuery);
      showToast(`Replaced text in ${res.changedNodeIds.length} files`, "success");
    } finally {
      setReplaceApplying(false);
    }
  }, [
    canEdit,
    ensureNodeMetadata,
    findQuery,
    loadFileContent,
    projectId,
    refreshFindReplaceData,
    replaceQuery,
    selectedReplaceNodeIds,
    showToast,
  ]);

  const handleRollbackBatchReplace = useCallback(async () => {
    if (!canEdit) {
      showToast("Write access required", "error");
      return;
    }
    if (lastReplaceBackup.length === 0) {
      showToast("No replace operation to rollback", "info");
      return;
    }
    setReplaceApplying(true);
    try {
      const res = await rollbackProjectSearchReplace(projectId, lastReplaceBackup);
      if (!res.success) {
        showToast(res.error || "Rollback failed", "error");
        return;
      }

      await ensureNodeMetadata(res.restoredNodeIds || []);
      for (const nodeId of res.restoredNodeIds || []) {
        const tab = tabByIdRef.current[nodeId];
        if (tab?.isDirty) continue;
        const node = useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById?.[nodeId];
        if (node && node.type === "file") {
          await loadFileContent(node);
        }
      }

      setLastReplaceBackup([]);
      await refreshFindReplaceData(findQuery, replaceQuery);
      showToast(`Rollback completed for ${(res.restoredNodeIds || []).length} files`, "success");
    } finally {
      setReplaceApplying(false);
    }
  }, [
    canEdit,
    ensureNodeMetadata,
    findQuery,
    lastReplaceBackup,
    loadFileContent,
    projectId,
    refreshFindReplaceData,
    replaceQuery,
    showToast,
  ]);

  const scheduleNextLockAttempt = useCallback((nodeId: string, lockExpiresAt?: number | null) => {
    const now = Date.now();
    const nextAttemptAt =
      typeof lockExpiresAt === "number" && Number.isFinite(lockExpiresAt)
        ? Math.max(now + LOCK_RETRY_MIN_DELAY_MS, lockExpiresAt + LOCK_RETRY_EXPIRY_BUFFER_MS)
        : now + LOCK_RETRY_FALLBACK_MS;
    nextLockAttemptAtRef.current.set(nodeId, nextAttemptAt);
  }, []);

  const clearLockAttemptSchedule = useCallback((nodeId: string) => {
    nextLockAttemptAtRef.current.delete(nodeId);
  }, []);

  const acquireLockForNode = useCallback(
    async (node: ProjectNode) => {
      if (!currentUserId) return;
      try {
        const res = (await acquireProjectNodeLock(projectId, node.id, 120)) as NodeLockResult;
        if (res.ok) {
          clearLockAttemptSchedule(node.id);
          setTabById((prev) => ({
            ...prev,
            [node.id]: { ...prev[node.id], hasLock: true, lockInfo: null },
          }));
          clearLock(projectId, node.id);
        } else {
          const lock = res.lock;
          if (!lock) {
            scheduleNextLockAttempt(node.id);
            setTabById((prev) => ({
              ...prev,
              [node.id]: { ...prev[node.id], hasLock: false },
            }));
            return;
          }
          scheduleNextLockAttempt(node.id, lock.expiresAt);
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
        scheduleNextLockAttempt(node.id);
        setTabById((prev) => ({
          ...prev,
          [node.id]: { ...prev[node.id], hasLock: false },
        }));
      }
    },
    [clearLock, clearLockAttemptSchedule, currentUserId, projectId, scheduleNextLockAttempt, setLock]
  );

  const openFileInPane = useCallback(
    async (node: ProjectNode, paneId?: PaneId) => {
      if (!node || node.type !== "file") return;
      const targetPane = paneId ?? activePane;

      setActivePane(targetPane);
      openTab(projectId, targetPane, node.id);
      setSelectedNode(projectId, node.id, node.parentId ?? null);
      setRecentFileIds((prev) => {
        const without = prev.filter((id) => id !== node.id);
        return [node.id, ...without].slice(0, 50);
      });

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
          } catch (e: unknown) {
            setTabById((prev) => ({
              ...prev,
              [node.id]: {
                ...prev[node.id],
                node,
                isLoading: false,
                error: getErrorMessage(e, "Failed to load preview"),
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

  const ensureSaveGuards = useCallback(
    async (nodeId: string, reason?: string) => {
      const tab = tabByIdRef.current[nodeId];
      if (!tab) return { ok: false as const, error: "Tab not found" };
      if (!tab.hasLock) return { ok: false as const, error: "File lock lost. Reopen the file and try again." };

      const refreshed = await refreshProjectNodeLock(projectId, nodeId, 120);
      if (!refreshed.ok) {
        setTabById((prev) => ({
          ...prev,
          [nodeId]: { ...prev[nodeId], hasLock: false },
        }));
        clearLock(projectId, nodeId);
        return { ok: false as const, error: "File lock expired. Reopen the file to continue." };
      }

      const now = Date.now();
      const lastCheckedAt = lastServerVersionCheckRef.current.get(nodeId) || 0;
      const shouldCheckVersion =
        reason !== "autosave" || now - lastCheckedAt > 15000;

      if (shouldCheckVersion) {
        lastServerVersionCheckRef.current.set(nodeId, now);
        const latest = (await getNodesByIds(projectId, [nodeId])) as ProjectNode[];
        const latestNode = latest[0];
        if (!latestNode) {
          return { ok: false as const, error: "File no longer exists." };
        }
        const serverUpdatedAt = new Date(latestNode.updatedAt).getTime();
        const localUpdatedAt = new Date(tab.node.updatedAt).getTime();
        if (serverUpdatedAt > localUpdatedAt + 500) {
          setTabById((prev) => ({
            ...prev,
            [nodeId]: { ...prev[nodeId], node: latestNode },
          }));
          return {
            ok: false as const,
            error: "File changed remotely. Reload and merge before saving.",
          };
        }
      }

      return { ok: true as const };
    },
    [clearLock, projectId]
  );

  const saveTab = useCallback(
    async (nodeId: string, opts?: { silent?: boolean; reason?: string }): Promise<boolean> => {
      if (!canEdit) return false;
      const existingInFlight = inFlightSaveByNodeRef.current.get(nodeId);
      if (existingInFlight) return existingInFlight;

      const runSave = (async (): Promise<boolean> => {
        const initialTab = tabByIdRef.current[nodeId];
        if (!initialTab) return false;
        if (!initialTab.node?.s3Key) return false;
        if (!initialTab.isDirty) return true;
        if (initialTab.isSaving) return false;
        if (!initialTab.hasLock) return false;

        if (isNoOpSave(initialTab.content, initialTab.savedSnapshot)) {
          setFileState(projectId, nodeId, { isDirty: false });
          setTabById((prev) => {
            const current = prev[nodeId];
            if (!current || !current.isDirty) return prev;
            return {
              ...prev,
              [nodeId]: {
                ...current,
                isDirty: false,
                offlineQueued: false,
              },
            };
          });
          return true;
        }

        const guard = await ensureSaveGuards(nodeId, opts?.reason);
        if (!guard.ok) {
          if (!opts?.silent) showToast(guard.error, "error");
          return false;
        }

        const tabForSave = tabByIdRef.current[nodeId];
        if (!tabForSave) {
          return false;
        }
        const contentToSave = tabForSave.content;
        const nodeToSave = tabForSave.node;

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
            queue[nodeId] = { content: contentToSave, ts: Date.now() };
            localStorage.setItem(key, JSON.stringify(queue));
          } catch {}
          if (!opts?.silent) showToast("Offline: changes queued", "success");
          return true;
        }

        setTabById((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], isSaving: true } }));

        try {
          const supabase = getSupabase();
          const blob = new Blob([contentToSave], { type: nodeToSave.mimeType || "text/plain" });
          const { error } = await supabase.storage
            .from("project-files")
            .update(nodeToSave.s3Key, blob, { upsert: true });
          if (error) throw error;

          // Calculate size in bytes
          const size = new TextEncoder().encode(contentToSave).length;

          // Update metadata in DB
          const updatedNode = (await updateProjectFileStats(projectId, nodeId, size)) as ProjectNode;

          // Update local node store immediately
          upsertNodes(projectId, [updatedNode]);

          // Update search index for text-like files (best-effort)
          try {
            const ext = nodeToSave.name.split(".").pop()?.toLowerCase();
            const isText =
              (nodeToSave.mimeType || "").startsWith("text/") ||
              ["ts", "tsx", "js", "jsx", "json", "md", "css", "html", "sql", "py", "txt"].includes(
                ext || ""
              );
            if (isText) {
              await upsertProjectFileIndex(projectId, nodeToSave.id, contentToSave);
            }
          } catch {
            // ignore indexing failures (search will be best-effort)
          }

          const latestContent = tabByIdRef.current[nodeId]?.content ?? contentToSave;
          const postSaveState = resolvePostSaveState({
            savedContent: contentToSave,
            currentContent: latestContent,
          });
          const savedAt = Date.now();
          setFileState(projectId, nodeId, {
            content: latestContent,
            isDirty: postSaveState.isDirty,
            lastSavedAt: savedAt,
          });
          setTabById((prev) => {
            const current = prev[nodeId];
            if (!current) return prev;
            return {
              ...prev,
              [nodeId]: {
                ...current,
                node: updatedNode,
                isSaving: false,
                isDirty: postSaveState.isDirty,
                savedSnapshot: postSaveState.savedSnapshot,
                offlineQueued: false,
                lastSavedAt: savedAt,
              },
            };
          });
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
              bytes: contentToSave.length,
            });
          } catch {}
          if (!opts?.silent) showToast("File saved", "success");
          return true;
        } catch (e: unknown) {
          setTabById((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], isSaving: false } }));
          if (!opts?.silent) showToast(`Failed to save: ${getErrorMessage(e, "Unknown error")}`, "error");
          return false;
        }
      })();

      inFlightSaveByNodeRef.current.set(nodeId, runSave);
      try {
        return await runSave;
      } finally {
        const current = inFlightSaveByNodeRef.current.get(nodeId);
        if (current === runSave) {
          inFlightSaveByNodeRef.current.delete(nodeId);
        }
      }
    },
    [canEdit, ensureSaveGuards, getSupabase, projectId, setFileState, showToast, upsertNodes]
  );

  const saveContentDirect = useCallback(
    async (
      node: ProjectNode,
      content: string,
      opts?: { silent?: boolean; reason?: string }
    ): Promise<boolean> => {
      if (!canEdit) return false;
      if (!node?.id || !node.s3Key) return false;

      if (opts?.reason !== "offline-flush") {
        const guard = await ensureSaveGuards(node.id, opts?.reason);
        if (!guard.ok) {
          if (!opts?.silent) showToast(guard.error, "error");
          return false;
        }
      }

      try {
        const supabase = getSupabase();
        const blob = new Blob([content], { type: node.mimeType || "text/plain" });
        const { error } = await supabase.storage
          .from("project-files")
          .update(node.s3Key, blob, { upsert: true });
        if (error) throw error;

        const size = new TextEncoder().encode(content).length;
        const updatedNode = (await updateProjectFileStats(projectId, node.id, size)) as ProjectNode;
        upsertNodes(projectId, [updatedNode]);

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
              node: updatedNode,
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
      } catch (e: unknown) {
        if (!opts?.silent) showToast(`Failed to save: ${getErrorMessage(e, "Unknown error")}`, "error");
        return false;
      }
    },
    [canEdit, ensureSaveGuards, getSupabase, projectId, setFileState, showToast, upsertNodes]
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
      nextLockAttemptAtRef.current.delete(nodeId);
      closeTabStore(projectId, paneId, nodeId);
    },
    [canEdit, clearLock, closeTabStore, projectId, saveTab, showToast]
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
        nextLockAttemptAtRef.current.delete(nodeId);
        showToast("Moved to Trash", "success");
      } catch (e: unknown) {
        setTabById((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], isDeleting: false } }));
        showToast(`Failed to delete file: ${getErrorMessage(e, "Unknown error")}`, "error");
      }
    },
    [canEdit, clearLock, projectId, removeNodeFromCaches, showToast]
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
          const lockRes = (await acquireProjectNodeLock(projectId, nodeId, 120)) as NodeLockResult;
          if (!lockRes.ok) continue;

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
  }, [canEdit, projectId, ensureNodeMetadata, showToast, saveContentDirect]);

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
            } catch (e: unknown) {
              setTabById((prev) => ({
                ...prev,
                [id]: { ...prev[id], isLoading: false, error: getErrorMessage(e, "Failed to load preview") },
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
     
  }, [
    ensureNodeMetadata,
    ensureSignedUrlForNode,
    leftOpenTabIds,
    leftOpenTabIdsKey,
    loadFileContent,
    projectId,
    rightOpenTabIds,
    rightOpenTabIdsKey,
    viewMode,
  ]);

  useEffect(() => {
    const openTabIds = new Set([...leftOpenTabIds, ...rightOpenTabIds]);
    for (const nodeId of Array.from(nextLockAttemptAtRef.current.keys())) {
      if (!openTabIds.has(nodeId)) {
        nextLockAttemptAtRef.current.delete(nodeId);
      }
    }
  }, [leftOpenTabIds, rightOpenTabIds, leftOpenTabIdsKey, rightOpenTabIdsKey]);

  // Save previous active tab on switch, per pane (best-effort)
  useEffect(() => {
    for (const paneId of panesToRender) {
      const prev = prevActiveRef.current[paneId];
      const current = activeTabIdByPane[paneId];
      if (prev && prev !== current) {
        const prevTab = tabByIdRef.current[prev];
        if (prevTab?.isDirty && canEdit) void saveTab(prev, { silent: true, reason: "switch" });
      }
      prevActiveRef.current[paneId] = current;
    }
  }, [activeTabIdByPane, canEdit, panesToRender, saveTab, leftActiveTabId, rightActiveTabId]);

  const tryAcquireActivePaneLocks = useCallback(() => {
    if (!currentUserId || !canEdit) return;
    const now = Date.now();
    for (const paneId of panesToRender) {
      const id = activeTabIdByPane[paneId];
      if (!id) continue;
      const tab = tabByIdRef.current[id];
      if (!tab || tab.hasLock) continue;
      const nextAttemptAt = nextLockAttemptAtRef.current.get(id) || 0;
      if (nextAttemptAt > now) continue;
      void acquireLockForNode(tab.node);
    }
  }, [acquireLockForNode, activeTabIdByPane, canEdit, currentUserId, panesToRender]);

  // Attempt lock acquisition immediately when active tabs change
  useEffect(() => {
    tryAcquireActivePaneLocks();
  }, [tryAcquireActivePaneLocks]);

  // Retry lock acquisition for active tabs with throttled backoff
  useEffect(() => {
    if (!currentUserId || !canEdit) return;
    const interval = window.setInterval(() => {
      tryAcquireActivePaneLocks();
    }, 3_000);
    return () => window.clearInterval(interval);
  }, [canEdit, currentUserId, tryAcquireActivePaneLocks]);

  // Debounced autosave per pane active tab
  useEffect(() => {
    const paneTimers = autosaveTimerRef.current;
    for (const paneId of panesToRender) {
      if (paneTimers[paneId]) clearTimeout(paneTimers[paneId]!);
      const id = activeTabIdByPane[paneId];
      if (!id || !canEdit) continue;
      const tab = tabByIdRef.current[id];
      if (!tab || !tab.isDirty || tab.isSaving) continue;

      paneTimers[paneId] = setTimeout(() => {
        void saveTab(id, { silent: true, reason: "autosave" });
      }, 2500);
    }
    return () => {
      for (const paneId of panesToRender) {
        if (paneTimers[paneId]) clearTimeout(paneTimers[paneId]!);
      }
    };
  }, [
    activeTabIdByPane,
    canEdit,
    panesToRender,
    saveTab,
    leftActiveTab?.content,
    leftActiveTab?.isDirty,
    leftActiveTab?.isSaving,
    rightActiveTab?.content,
    rightActiveTab?.isDirty,
    rightActiveTab?.isSaving,
  ]);

  // Keepalive for active locks
  useEffect(() => {
    if (!currentUserId) return;
    const interval = setInterval(() => {
      const activeIds = new Set<string>();
      for (const paneId of panesToRender) {
        const id = activeTabIdByPane[paneId];
        if (id) activeIds.add(id);
      }
      for (const id of activeIds) {
        const tab = tabByIdRef.current[id];
        if (!tab?.hasLock) continue;
        void refreshProjectNodeLock(projectId, id, 120);
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [activeTabIdByPane, currentUserId, panesToRender, projectId, leftActiveTabId, rightActiveTabId]);

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

  const handleOpenRunnerDiagnostic = useCallback(
    async (nodeId: string | null, filePath?: string | null) => {
      let resolvedNodeId = nodeId;
      if (!resolvedNodeId && filePath) {
        const byPath = await findNodeByPathAny(
          projectId,
          filePath.split("/").filter(Boolean)
        );
        resolvedNodeId = byPath?.id ?? null;
      }
      if (!resolvedNodeId) return;

      let node = useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById?.[resolvedNodeId];
      if (!node) {
        await ensureNodeMetadata([resolvedNodeId]);
        node = useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById?.[resolvedNodeId];
      }
      if (!node || node.type !== "file") {
        showToast("Diagnostic file is no longer available", "error");
        return;
      }
      await openFileInPane(node, activePane);
    },
    [activePane, ensureNodeMetadata, openFileInPane, projectId, showToast]
  );

  return (
    <div className="flex-1 w-full min-h-0 flex bg-white dark:bg-zinc-950 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm relative isolate">
      {/* Explorer */}
      <div className="w-[290px] flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col h-full bg-zinc-50/50 dark:bg-zinc-900/50 relative z-10">
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

        <div className="relative z-10 flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 shrink-0">
              Editor
            </div>
            {headerSearchOpen ? (
              <input
                autoFocus
                value={headerSearchQuery}
                onChange={(e) => setHeaderSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setHeaderSearchOpen(false);
                    setHeaderSearchQuery("");
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setQuickOpenOpen(true);
                    setQuickOpenQuery(headerSearchQuery.trim());
                  }
                }}
                placeholder="Search files..."
                className="h-7 w-[180px] rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 text-xs outline-none"
              />
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                  <Layers className="w-3.5 h-3.5 mr-1.5" />
                  {viewMode === "code" ? "Code" : viewMode === "assets" ? "Assets" : "All"}
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
              className="h-7 w-7 p-0"
              onClick={() => {
                setHeaderSearchOpen((prev) => !prev);
                if (headerSearchOpen) setHeaderSearchQuery("");
              }}
              title="Search files"
            >
              <Search className="w-3.5 h-3.5" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                  <Play className="w-3.5 h-3.5 mr-1.5" />
                  Run
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  disabled={!canEdit || runnerLoading || runnerProfiles.length === 0}
                  onClick={() => void runSelectedProfile()}
                >
                  {runnerLoading ? "Running..." : "Run selected profile"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setRunnerOpen((prev) => !prev)}>
                  {runnerOpen ? "Hide runner panel" : "Show runner panel"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void refreshRunnerSessions(activeRunnerSessionId, { force: true })}>
                  Refresh run history
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {runnerProfiles.length === 0 ? (
                  <DropdownMenuItem disabled>No profiles</DropdownMenuItem>
                ) : (
                  runnerProfiles.map((profile) => (
                    <DropdownMenuCheckboxItem
                      key={profile.id}
                      checked={selectedRunnerProfileId === profile.id}
                      onCheckedChange={(checked) => {
                        if (checked) setSelectedRunnerProfileId(profile.id);
                      }}
                    >
                      {profile.name}
                    </DropdownMenuCheckboxItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              size="sm"
              variant={runnerOpen ? "secondary" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setRunnerOpen((prev) => !prev)}
              title={runnerOpen ? "Hide runner panel" : "Show runner panel"}
            >
              <TerminalSquare className="w-3.5 h-3.5 mr-1.5" />
              Runner
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                  <MoreVertical className="w-3.5 h-3.5 mr-1.5" />
                  Workspace
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  onClick={() => {
                    setQuickOpenOpen(true);
                    setQuickOpenQuery("");
                  }}
                >
                  Quick open
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFindOpen(true)}>Find in project</DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setCommandOpen(true);
                    setCommandQuery("");
                  }}
                >
                  Command palette
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSplitEnabled(projectId, !splitEnabled)}>
                  {splitEnabled ? "Single editor mode" : "Split editor mode"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setPrefs(projectId, { lineNumbers: !prefs.lineNumbers })}>
                  {prefs.lineNumbers ? "Hide" : "Show"} line numbers
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPrefs(projectId, { wordWrap: !prefs.wordWrap })}>
                  {prefs.wordWrap ? "Disable" : "Enable"} word wrap
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPrefs(projectId, { minimap: !prefs.minimap })}>
                  {prefs.minimap ? "Hide" : "Show"} minimap
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPrefs(projectId, { fontSize: Math.max(12, prefs.fontSize - 1) })}>
                  Font size -
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPrefs(projectId, { fontSize: Math.min(20, prefs.fontSize + 1) })}>
                  Font size +
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
              const current = tabByIdRef.current[id];
              if (!current || current.content === next) return;
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
                const current = tabByIdRef.current[id];
                if (!current || current.content === next) return;
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

        {/* Quick Open */}
        {quickOpenOpen ? (
          <div className="absolute inset-0 z-20 bg-black/30 flex items-start justify-center p-4 pt-16">
            <div className="w-full max-w-2xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                <input
                  autoFocus
                  className="w-full h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm outline-none"
                  placeholder="Quick open files..."
                  value={quickOpenQuery}
                  onChange={(e) => setQuickOpenQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setQuickOpenOpen(false);
                      return;
                    }
                    if (e.key === "Enter" && quickOpenResults[0]) {
                      e.preventDefault();
                      void openFileInPane(quickOpenResults[0], activePane);
                      setQuickOpenOpen(false);
                      setQuickOpenQuery("");
                    }
                  }}
                />
              </div>
              <div className="max-h-[60vh] overflow-auto divide-y divide-zinc-200 dark:divide-zinc-800">
                {quickOpenResults.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-zinc-500">No matching files</div>
                ) : (
                  quickOpenResults.map((node) => (
                    <button
                      key={node.id}
                      className="w-full text-left px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      onClick={() => {
                        void openFileInPane(node, activePane);
                        setQuickOpenOpen(false);
                        setQuickOpenQuery("");
                      }}
                    >
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{node.name}</div>
                      <div className="text-xs text-zinc-500 truncate">{nodePathById.get(node.id) || node.name}</div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* Command Palette */}
        {commandOpen ? (
          <div className="absolute inset-0 z-20 bg-black/30 flex items-start justify-center p-4 pt-16">
            <div className="w-full max-w-xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                <input
                  autoFocus
                  className="w-full h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm outline-none"
                  placeholder="Type a command..."
                  value={commandQuery}
                  onChange={(e) => setCommandQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setCommandOpen(false);
                      return;
                    }
                    if (e.key === "Enter" && filteredCommandActions[0]) {
                      e.preventDefault();
                      filteredCommandActions[0].run();
                      setCommandOpen(false);
                      setCommandQuery("");
                    }
                  }}
                />
              </div>
              <div className="max-h-[50vh] overflow-auto divide-y divide-zinc-200 dark:divide-zinc-800">
                {filteredCommandActions.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-zinc-500">No command found</div>
                ) : (
                  filteredCommandActions.map((action) => (
                    <button
                      key={action.id}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      onClick={() => {
                        action.run();
                        setCommandOpen(false);
                        setCommandQuery("");
                      }}
                    >
                      {action.label}
                    </button>
                  ))
                )}
              </div>
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
                    setReplaceQuery("");
                    setFindResults([]);
                    setReplacePreviewItems([]);
                    setSelectedReplaceNodeIds([]);
                  }}
                  aria-label="Close find"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    autoFocus
                    className="w-full h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm outline-none"
                    placeholder="Search text (indexed on save)…"
                    value={findQuery}
                    onChange={(e) => setFindQuery(e.target.value)}
                  />
                  <input
                    className="w-full h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm outline-none"
                    placeholder="Replace with..."
                    value={replaceQuery}
                    onChange={(e) => setReplaceQuery(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (replacePreviewItems.length === 0) return;
                      setSelectedReplaceNodeIds(replacePreviewItems.map((item) => item.nodeId));
                    }}
                    disabled={replacePreviewItems.length === 0}
                  >
                    Select all
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedReplaceNodeIds([])}
                    disabled={selectedReplaceNodeIds.length === 0}
                  >
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleApplyBatchReplace()}
                    disabled={!canEdit || replaceApplying || selectedReplaceNodeIds.length === 0}
                  >
                    {replaceApplying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Apply Replace
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleRollbackBatchReplace()}
                    disabled={!canEdit || replaceApplying || lastReplaceBackup.length === 0}
                  >
                    Rollback Last
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                    <div className="px-3 py-2 text-xs font-semibold border-b border-zinc-200 dark:border-zinc-800">Search Results</div>
                    <div className="max-h-[38vh] overflow-auto">
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
                  </div>

                  <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                    <div className="px-3 py-2 text-xs font-semibold border-b border-zinc-200 dark:border-zinc-800">
                      Replace Preview ({selectedReplaceNodeIds.length} selected)
                    </div>
                    <div className="max-h-[38vh] overflow-auto">
                      {replacePreviewLoading ? (
                        <div className="p-3 text-sm text-zinc-500">Preparing preview…</div>
                      ) : replacePreviewItems.length === 0 ? (
                        <div className="p-3 text-sm text-zinc-500">No files to replace</div>
                      ) : (
                        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                          {replacePreviewItems.map((item) => {
                            const checked = selectedReplaceNodeIds.includes(item.nodeId);
                            const node = nodesById[item.nodeId];
                            return (
                              <div key={item.nodeId} className="px-3 py-2 space-y-1">
                                <label className="flex items-center gap-2 text-xs text-zinc-800 dark:text-zinc-200">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      setSelectedReplaceNodeIds((prev) => {
                                        if (e.target.checked) return Array.from(new Set([...prev, item.nodeId]));
                                        return prev.filter((id) => id !== item.nodeId);
                                      });
                                    }}
                                  />
                                  <span className="font-semibold truncate">{node?.name || item.name}</span>
                                  <span className="text-zinc-500 ml-auto">{item.occurrenceCount} hits</span>
                                </label>
                                <div className="text-[11px] text-zinc-500 font-mono break-words">
                                  {item.beforeSnippet}
                                </div>
                                <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono break-words">
                                  {item.afterSnippet}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-zinc-400">
                  Indexed-search scope only. Batch replace is fenced to selected files and can rollback the latest operation.
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <RunnerPanel
          open={runnerOpen}
          loading={runnerLoading}
          sessions={runnerSessions}
          detail={activeRunnerDetail}
          storageKey={`files-runner-ui:${projectId}`}
          onToggleOpen={() => setRunnerOpen((prev) => !prev)}
          onSelectSession={(sessionId) => setActiveRunnerSessionId(sessionId)}
          onOpenDiagnostic={(nodeId, filePath) => {
            void handleOpenRunnerDiagnostic(nodeId, filePath);
          }}
          onRefreshRuns={() => {
            void refreshRunnerSessions(activeRunnerSessionId, { force: true });
          }}
        />
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
