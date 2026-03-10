"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import type { ProjectNode } from "@/lib/db/schema";
import { useToast } from "@/components/ui-custom/Toast";
const FileExplorer = dynamic(() => import("../explorer/FileExplorer"), { ssr: false });
import { getGitStatus } from "@/app/actions/git";
import { findNodeByPathAny } from "@/app/actions/files";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { FilesViewMode } from "@/stores/filesWorkspaceStore";
import { filesFeatureFlags, isFilesHardeningEnabled } from "@/lib/features/files";
import type { FilesWorkspaceTabState, PaneId } from "../state/filesTabTypes";
import WorkspaceSyncOverlay from "./WorkspaceSyncOverlay";
import { useWorkspaceKeyboard } from "./WorkspaceKeyboard";
import { useAutoSave } from "./WorkspaceAutoSave";
import { useLintOnEdit } from "./useLintOnEdit";
import { useLockManager } from "./WorkspaceLockManager";
import { useWorkspaceLifecycle } from "./useWorkspaceLifecycle";
import { useTabManager } from "./WorkspaceTabManager";
import { runFileWithContent } from "@/lib/runner/runFile";
import { parseStderrToProblems } from "@/app/actions/parseStderrToProblems";
import { WorkspacePaneHost } from "./WorkspacePaneHost";
import { WorkspaceModalsHost } from "./WorkspaceModalsHost";
import { WorkspaceBottomPanelHost } from "./WorkspaceBottomPanelHost";
import { useWorkspaceUiState } from "./useWorkspaceUiState";
import {
  getFileContent,
  setFileContent as setDetachedContent,
} from "@/stores/filesWorkspaceStore";
import { useWorkspaceLayoutState } from "./useWorkspaceLayoutState";
import { useCursorPresence } from "./useCursorPresence";
import { useWorkspacePane } from "./useWorkspacePane";
import { StatusBar } from "./StatusBar";
import { KeyboardShortcuts } from "./KeyboardShortcuts";

const EMPTY_ARRAY: string[] = [];
const DEFAULT_PANES = {
  left: { openTabIds: [], activeTabId: null },
  right: { openTabIds: [], activeTabId: null },
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

interface ProjectFilesWorkspaceProps {
  projectId: string;
  projectName?: string;
  currentUserId?: string;
  isOwnerOrMember: boolean;
  syncStatus?: "pending" | "cloning" | "indexing" | "ready" | "failed";
  importSourceType?: "github" | "upload" | "scratch" | null;
  initialOpenPath?: string | null;
  initialOpenLine?: number | null;
  initialOpenColumn?: number | null;
}

export default function WorkspaceShell({
  projectId,
  projectName,
  currentUserId,
  isOwnerOrMember,
  initialFileNodes,
  syncStatus: initialSyncStatus = "ready",
  importSourceType,
  initialOpenPath,
  initialOpenLine,
  initialOpenColumn,
}: ProjectFilesWorkspaceProps & { initialFileNodes?: ProjectNode[] }) {
  const canEdit = isOwnerOrMember;
  const filesHardeningEnabled = isFilesHardeningEnabled(currentUserId ?? null);
  const { showToast } = useToast();
  const searchParams = useSearchParams();

  // Sync state (received from WorkspaceSyncOverlay via callback)
  const [syncState, setSyncState] = useState(initialSyncStatus);
  const [startupStage, setStartupStage] = useState<"explorer" | "editor" | "diagnostics">(
    filesHardeningEnabled ? "explorer" : "diagnostics"
  );
  const shouldMountEditor = startupStage !== "explorer";
  const shouldMountDiagnostics = startupStage === "diagnostics";

  useEffect(() => {
    if (!filesHardeningEnabled) {
      setStartupStage("diagnostics");
      return;
    }
    let cancelled = false;
    setStartupStage("explorer");
    const editorTimer = window.setTimeout(() => {
      if (!cancelled) setStartupStage("editor");
    }, 50);
    const diagnosticsTimer = window.setTimeout(() => {
      if (!cancelled) setStartupStage("diagnostics");
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(editorTimer);
      window.clearTimeout(diagnosticsTimer);
    };
  }, [filesHardeningEnabled, projectId]);

  // Store selectors
  const leftOpenTabIds = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.panes.left.openTabIds || EMPTY_ARRAY
  );
  const rightOpenTabIds = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.panes.right.openTabIds || EMPTY_ARRAY
  );
  const leftActiveTabId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.panes.left.activeTabId
  );
  const rightActiveTabId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.panes.right.activeTabId
  );
  const splitEnabled = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.splitEnabled
  );
  const splitRatio = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.splitRatio ?? 0.5
  );
  const viewMode = useFilesWorkspaceStore(
    (s) => (s.byProjectId[projectId]?.viewMode as FilesViewMode) || "code"
  );
  const panes = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.panes || DEFAULT_PANES
  );
  const prefs = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.prefs || DEFAULT_PREFS
  );
  const pinnedByTabId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.pinnedByTabId || DEFAULT_PINNED
  );

  const activeTabIdByPane = useMemo<Record<PaneId, string | null>>(
    () => ({
      left: leftActiveTabId ?? null,
      right: rightActiveTabId ?? null,
    }),
    [leftActiveTabId, rightActiveTabId]
  );

  const pinTab = useFilesWorkspaceStore((s) => s.pinTab);
  const closeOtherTabs = useFilesWorkspaceStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useFilesWorkspaceStore((s) => s.closeTabsToRight);
  const setSplitEnabled = useFilesWorkspaceStore((s) => s.setSplitEnabled);
  const setSplitRatio = useFilesWorkspaceStore((s) => s.setSplitRatio);
  const setPrefs = useFilesWorkspaceStore((s) => s.setPrefs);
  const setViewMode = useFilesWorkspaceStore((s) => s.setViewMode);
  const setSelectedNode = useFilesWorkspaceStore((s) => s.setSelectedNode);
  const requestScrollTo = useFilesWorkspaceStore((s) => s.requestScrollTo);
  const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);
  const removeNodeFromCaches = useFilesWorkspaceStore((s) => s.removeNodeFromCaches);
  const setFileState = useFilesWorkspaceStore((s) => s.setFileState);
  const bottomPanelCollapsed = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.ui?.bottomPanelCollapsed ?? true
  );
  const sidebarWidth = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.ui?.sidebarWidth ?? 290
  );
  const sidebarCollapsed = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.ui?.sidebarCollapsed ?? false
  );
  const zenMode = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.ui?.zenMode ?? false
  );
  const gitChangedFiles = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.git?.changedFiles || EMPTY_ARRAY
  );
  const toggleBottomPanel = useFilesWorkspaceStore((s) => s.toggleBottomPanel);
  const setBottomPanelTab = useFilesWorkspaceStore((s) => s.setBottomPanelTab);
  const setLastExecutionOutput = useFilesWorkspaceStore((s) => s.setLastExecutionOutput);
  const setLastExecutionSettingsHref = useFilesWorkspaceStore((s) => s.setLastExecutionSettingsHref);
  const setSidebarWidth = useFilesWorkspaceStore((s) => s.setSidebarWidth);
  const toggleSidebar = useFilesWorkspaceStore((s) => s.toggleSidebar);
  const toggleZenMode = useFilesWorkspaceStore((s) => s.toggleZenMode);
  const selectedNodeId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.selectedNodeId ?? null
  );
  const galleryChildIds = useFilesWorkspaceStore((s) => {
    const ws = s.byProjectId[projectId];
    if (!ws) return EMPTY_ARRAY;
    const pk = selectedNodeId && ws.nodesById[selectedNodeId]?.type === "folder"
      ? selectedNodeId
      : "__root__";
    return ws.childrenByParentId[pk] ?? EMPTY_ARRAY;
  });

  // Pane layout
  const {
    activePane,
    setActivePane,
    panesToRender,
    leftOpenTabIdsKey,
    rightOpenTabIdsKey,
    startResize,
  } = useWorkspaceLayoutState({
    projectId,
    splitEnabled,
    splitRatio,
    leftOpenTabIds,
    rightOpenTabIds,
    setSplitRatio,
  });

  // Tab state (shared between lock manager and tab manager)
  const [tabById, setTabById] = useState<Record<string, FilesWorkspaceTabState>>({});
  const tabByIdRef = useRef<Record<string, FilesWorkspaceTabState>>({});
  useEffect(() => {
    tabByIdRef.current = tabById;
  }, [tabById]);

  const {
    leftActiveTab,
    rightActiveTab,
    leftOrderedTabIds,
    rightOrderedTabIds,
    getPaneForTab,
  } = useWorkspacePane({
    panes,
    pinnedByTabId,
    activeTabIdByPane,
    tabById,
  });

  // Phase 5: Binary-Packed WebSocket Cursor Presence
  const { remoteCursors, broadcastCursor, cursorVersion } = useCursorPresence({
    projectId,
    currentUserId: currentUserId ?? "",
    enabled: !!currentUserId,
  });

  // Lock manager
  const { acquireLockForNode, nextLockAttemptAtRef } = useLockManager({
    projectId,
    currentUserId,
    canEdit,
    panesToRender,
    activeTabIdByPane,
    tabByIdRef,
    setTabById,
    leftActiveTabId: leftActiveTabId ?? null,
    rightActiveTabId: rightActiveTabId ?? null,
    leftOpenTabIds,
    rightOpenTabIds,
    leftOpenTabIdsKey,
    rightOpenTabIdsKey,
  });

  // UI states
  const {
    findOpen,
    setFindOpen,
    quickOpenOpen,
    setQuickOpenOpen,
    quickOpenQuery,
    setQuickOpenQuery,
    commandOpen,
    setCommandOpen,
    commandQuery,
    setCommandQuery,
    recentFileIds,
    setRecentFileIds,
  } = useWorkspaceUiState();

  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Tab manager
  const {
    conflictDialog,
    setConflictDialog,
    fileNodes,
    nodePathById,
    nodesById,
    sensors,
    handleDragEnd,
    openFileInPane,
    closeTab,
    deleteFile,
    saveTab,
    saveContentDirect,
    loadFileContent,
    ensureNodeMetadata,
  } = useTabManager({
    projectId,
    currentUserId,
    canEdit,
    viewMode,
    activePane,
    setActivePane,
    showToast,
    tabById,
    setTabById,
    tabByIdRef,
    acquireLockForNode,
    nextLockAttemptAtRef,
    leftOpenTabIds,
    rightOpenTabIds,
    leftOpenTabIdsKey,
    rightOpenTabIdsKey,
    setRecentFileIds,
  });

  const rootNodes = useMemo(() => {
    if (galleryChildIds === EMPTY_ARRAY || galleryChildIds.length === 0) return [];
    return galleryChildIds
      .map((id) => nodesById[id])
      .filter(Boolean) as ProjectNode[];
  }, [galleryChildIds, nodesById]);

  const activeFilePath = useMemo(() => {
    const activeTabId = activeTabIdByPane[activePane];
    if (!activeTabId) return undefined;
    const path = nodePathById.get(activeTabId);
    if (!path || path === "") return undefined;
    const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
    const runnable = [".py", ".js", ".mjs", ".sql", ".ts", ".tsx", ".java", ".c", ".cpp", ".cc"];
    if (runnable.includes(ext)) return path;
    return undefined;
  }, [activeTabIdByPane, activePane, nodePathById]);

  const problems = useFilesWorkspaceStore((s) => s._get(projectId).ui.problems ?? []);
  const setProblems = useFilesWorkspaceStore((s) => s.setProblems);
  const setStdinInputText = useFilesWorkspaceStore((s) => s.setStdinInputText);
  const appendDebugOutput = useFilesWorkspaceStore((s) => s.appendDebugOutput);

  const runActiveFile = useCallback(async () => {
    if (!activeFilePath) return;
    const activeTabId = activeTabIdByPane[activePane];
    if (!activeTabId) return;
    const tab = tabById[activeTabId];
    if (!tab) return;
    // Phase 5: Read content from detached Map
    const content = getFileContent(projectId, activeTabId);
    if (!content) return;

    if (bottomPanelCollapsed) toggleBottomPanel(projectId);
    setBottomPanelTab(projectId, "output");

    const stdinText = useFilesWorkspaceStore.getState()._get(projectId).ui.stdinInputText;
    const stdinLines = stdinText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const result = await runFileWithContent(projectId, activeFilePath, content, {
      stdinLines: stdinLines.length > 0 ? stdinLines : undefined,
    });
    const logs = result.success ? [...result.logs, "Code execution successful."] : result.logs;
    setLastExecutionOutput(projectId, logs);
    setLastExecutionSettingsHref(projectId, result.success ? null : (result.settingsHref ?? null));
    appendDebugOutput(projectId, result.logs);

    if (result.success) {
      setStdinInputText(projectId, "");
    } else if (result.stderr) {
      const execProblems = await parseStderrToProblems(projectId, result.stderr);
      const existing = useFilesWorkspaceStore.getState()._get(projectId).ui.problems ?? [];
      const merged = [...existing.filter((p) => p.source !== "execution"), ...execProblems];
      setProblems(projectId, merged);
    }
  }, [
    activeFilePath,
    activeTabIdByPane,
    activePane,
    tabById,
    bottomPanelCollapsed,
    projectId,
    toggleBottomPanel,
    setBottomPanelTab,
    setLastExecutionOutput,
    setLastExecutionSettingsHref,
    appendDebugOutput,
    setStdinInputText,
    setProblems,
  ]);

  // Lifecycle (workspace init + offline queue)
  useWorkspaceLifecycle({
    projectId,
    canEdit,
    initialFileNodes,
    showToast,
    ensureNodeMetadata,
    saveContentDirect,
  });

  const deepLinkHandledRef = useRef<string | null>(null);
  const deepLinkRequestIdRef = useRef(0);
  useEffect(() => {
    const pathFromQuery = initialOpenPath ?? searchParams?.get("path") ?? null;
    if (!pathFromQuery) return;

    const normalizedPath = pathFromQuery
      .split("/")
      .map((segment) => decodeURIComponent(segment).trim())
      .filter(Boolean);
    if (normalizedPath.length === 0) return;

    const queryLine = searchParams?.get("line");
    const rawLine = initialOpenLine ?? (queryLine ? Number(queryLine) : null);
    const line = Number.isFinite(rawLine) && (rawLine ?? 0) > 0 ? Number(rawLine) : null;
    const queryColumn = searchParams?.get("column");
    const rawColumn = initialOpenColumn ?? (queryColumn ? Number(queryColumn) : null);
    const column =
      Number.isFinite(rawColumn) && (rawColumn ?? 0) > 0 ? Number(rawColumn) : null;

    const deepLinkKey = `${projectId}:${normalizedPath.join("/")}:${line ?? 0}:${column ?? 0}`;
    if (deepLinkHandledRef.current === deepLinkKey) return;
    deepLinkHandledRef.current = deepLinkKey;
    const requestId = ++deepLinkRequestIdRef.current;
    let cancelled = false;

    void (async () => {
      try {
        const node = await findNodeByPathAny(projectId, normalizedPath);
        if (!node || cancelled || requestId !== deepLinkRequestIdRef.current) return;
        if (node.type === "folder") {
          setSelectedNode(projectId, node.id, node.parentId ?? null);
          toggleExpanded(projectId, node.id, true);
          return;
        }
        await openFileInPane(node, "left");
        if (cancelled || requestId !== deepLinkRequestIdRef.current) return;
        setSelectedNode(projectId, node.id, node.parentId ?? null);
        if (line) {
          requestScrollTo(projectId, node.id, line);
        }
      } catch (error) {
        if (!cancelled && requestId === deepLinkRequestIdRef.current) {
          console.error("Failed to open files deep link", error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    initialOpenPath,
    initialOpenLine,
    initialOpenColumn,
    openFileInPane,
    projectId,
    requestScrollTo,
    searchParams,
    setSelectedNode,
    toggleExpanded,
  ]);

  // Autosave
  useAutoSave({
    projectId,
    canEdit: canEdit && shouldMountEditor,
    panesToRender,
    activeTabIdByPane,
    tabByIdRef,
    saveTab,
    autosaveDelayMs: prefs.autosaveDelayMs,
    backgroundConcurrency: prefs.inactiveAutosaveConcurrency,
    leftActiveTab,
    rightActiveTab,
    leftActiveTabId,
    rightActiveTabId,
  });

  // Lint on edit (debounced 500ms)
  useLintOnEdit({
    projectId,
    canEdit: canEdit && shouldMountDiagnostics,
    panesToRender,
    activeTabIdByPane,
    tabByIdRef,
    leftActiveTab,
    rightActiveTab,
  });

  // Keyboard shortcuts
  const handleKeyboardQuickOpen = useCallback(() => {
    setQuickOpenOpen(true);
    setQuickOpenQuery("");
  }, [setQuickOpenOpen, setQuickOpenQuery]);
  const handleKeyboardCommandPalette = useCallback(() => {
    setCommandOpen(true);
    setCommandQuery("");
  }, [setCommandOpen, setCommandQuery]);
  const handleKeyboardFindInProject = useCallback(() => {
    setFindOpen(true);
  }, [setFindOpen]);
  const handleKeyboardShowShortcuts = useCallback(() => {
    setShortcutsOpen(true);
  }, [setShortcutsOpen]);
  const handleKeyboardCloseQuickOpen = useCallback(() => setQuickOpenOpen(false), [setQuickOpenOpen]);
  const handleKeyboardCloseCommand = useCallback(() => setCommandOpen(false), [setCommandOpen]);

  // Sidebar resize
  const sidebarDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const [isSidebarDragging, setIsSidebarDragging] = useState(false);

  useEffect(() => {
    if (!isSidebarDragging) return;
    const onMouseMove = (e: MouseEvent) => {
      if (!sidebarDragRef.current) return;
      const delta = e.clientX - sidebarDragRef.current.startX;
      setSidebarWidth(projectId, sidebarDragRef.current.startW + delta);
    };
    const onMouseUp = () => {
      sidebarDragRef.current = null;
      setIsSidebarDragging(false);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [isSidebarDragging, projectId, setSidebarWidth]);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sidebarDragRef.current = { startX: e.clientX, startW: sidebarWidth };
    setIsSidebarDragging(true);
  }, [sidebarWidth]);

  const handleToggleSidebar = useCallback(() => toggleSidebar(projectId), [projectId, toggleSidebar]);
  const handleToggleZenMode = useCallback(() => toggleZenMode(projectId), [projectId, toggleZenMode]);
  const handleQuickSwitch = useCallback(() => {
    setQuickOpenOpen(true);
    setQuickOpenQuery("");
  }, [setQuickOpenOpen, setQuickOpenQuery]);

  const handleKeyboardNewFile = useCallback(() => {
    setCommandOpen(true);
    setCommandQuery("Create File");
  }, [setCommandOpen, setCommandQuery]);

  const handleKeyboardSave = useCallback(() => {
    const activeTabId = activeTabIdByPane[activePane];
    if (activeTabId) saveTab(activeTabId);
  }, [activeTabIdByPane, activePane, saveTab]);

  const handleKeyboardDelete = useCallback(() => {
    const activeTabId = activeTabIdByPane[activePane];
    if (activeTabId) deleteFile(activeTabId);
  }, [activeTabIdByPane, activePane, deleteFile]);

  const handleKeyboardQuickLook = useCallback(() => {
    const activeId = activeTabIdByPane[activePane] || useFilesWorkspaceStore.getState().byProjectId[projectId]?.selectedNodeId;
    if (activeId) {
      setQuickOpenOpen(true);
      setQuickOpenQuery(nodesById[activeId]?.name || "");
    }
  }, [activeTabIdByPane, activePane, projectId, setQuickOpenOpen, setQuickOpenQuery, nodesById]);

  useWorkspaceKeyboard({
    onQuickOpen: handleKeyboardQuickOpen,
    onCommandPalette: handleKeyboardCommandPalette,
    onFindInProject: handleKeyboardFindInProject,
    onToggleSidebar: handleToggleSidebar,
    onToggleZenMode: handleToggleZenMode,
    onQuickSwitch: handleQuickSwitch,
    quickOpenOpen,
    commandOpen,
    onCloseQuickOpen: handleKeyboardCloseQuickOpen,
    onCloseCommand: handleKeyboardCloseCommand,
    onNewFile: handleKeyboardNewFile,
    onSave: handleKeyboardSave,
    onDelete: handleKeyboardDelete,
    onQuickLook: handleKeyboardQuickLook,
    onShowShortcuts: handleKeyboardShowShortcuts,
  });

  // Recent file persistence
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`files-recent-open:${projectId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecentFileIds(
          parsed.filter((id): id is string => typeof id === "string").slice(0, 50)
        );
      }
    } catch {}
  }, [projectId]);

  useEffect(() => {
    try {
      localStorage.setItem(
        `files-recent-open:${projectId}`,
        JSON.stringify(recentFileIds.slice(0, 50))
      );
    } catch {}
  }, [projectId, recentFileIds]);

  // Git bootstrap (single fetch on mount)
  const setGitRepo = useFilesWorkspaceStore((s) => s.setGitRepo);
  const setGitChangedFiles = useFilesWorkspaceStore((s) => s.setGitChangedFiles);
  const setGitLastSync = useFilesWorkspaceStore((s) => s.setGitLastSync);
  const setGitStatusLoaded = useFilesWorkspaceStore((s) => s.setGitStatusLoaded);
  const gitBootstrapRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (
      !filesHardeningEnabled ||
      !shouldMountDiagnostics ||
      !filesFeatureFlags.wave4GitIntegration ||
      gitBootstrapRef.current.has(projectId)
    )
      return;
    gitBootstrapRef.current.add(projectId);
    let cancelled = false;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Git status timeout")), 10_000)
    );
    Promise.race([getGitStatus(projectId), timeout])
      .then((status) => {
        if (cancelled) return;
        if (status.connected && status.repoUrl) {
          setGitRepo(projectId, status.repoUrl, status.branch ?? "main");
          setGitChangedFiles(
            projectId,
            status.changedFiles.map((f) => ({
              nodeId: f.nodeId,
              status: f.status as "modified" | "added" | "deleted",
            }))
          );
          if (status.lastSyncAt && status.lastCommitSha) {
            setGitLastSync(projectId, status.lastSyncAt, status.lastCommitSha);
          }
        }
        setGitStatusLoaded(projectId, true);
      })
      .catch(() => {
        if (!cancelled) setGitStatusLoaded(projectId, true);
      });
    return () => {
      cancelled = true;
      gitBootstrapRef.current.delete(projectId);
      setGitStatusLoaded(projectId, true);
    };
  }, [
    filesHardeningEnabled,
    shouldMountDiagnostics,
    projectId,
    setGitRepo,
    setGitChangedFiles,
    setGitLastSync,
    setGitStatusLoaded,
  ]);

  // Command palette
  const commandActions = useMemo(
    () =>
      [
        {
          id: "find",
          label: "Find in Project",
          run: () => setFindOpen(true),
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
          id: "toggle-panel",
          label: bottomPanelCollapsed ? "Show Bottom Panel" : "Hide Bottom Panel",
          run: () => toggleBottomPanel(projectId),
        },
        ...(activeFilePath
          ? [
              {
                id: "run-active",
                label: "Run active file",
                run: () => void runActiveFile(),
              },
            ]
          : []),
        {
          id: "toggle-sidebar",
          label: sidebarCollapsed ? "Show Sidebar (⌘B)" : "Hide Sidebar (⌘B)",
          run: () => toggleSidebar(projectId),
        },
        {
          id: "toggle-zen",
          label: zenMode ? "Exit Zen Mode (⌘K Z)" : "Enter Zen Mode (⌘K Z)",
          run: () => toggleZenMode(projectId),
        },
      ] as Array<{ id: string; label: string; run: () => void }>,
    [
      activeFilePath,
      bottomPanelCollapsed,
      projectId,
      runActiveFile,
      setFindOpen,
      setSplitEnabled,
      setViewMode,
      sidebarCollapsed,
      splitEnabled,
      toggleBottomPanel,
      toggleSidebar,
      toggleZenMode,
      zenMode,
    ]
  );

  const filteredCommandActions = useMemo(() => {
    const q = commandQuery.trim().toLowerCase();
    if (!q) return commandActions;
    return commandActions.filter((action) => action.label.toLowerCase().includes(q));
  }, [commandActions, commandQuery]);

  // Quick open results
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

  return (
    <div className={cn(
      "flex-1 w-full min-h-0 flex bg-white dark:bg-zinc-950 overflow-hidden relative isolate",
      isSidebarDragging && "select-none"
    )}>
      {/* Explorer — resizable + collapsible */}
      {/* Explorer — resizable + collapsible */}
      <div
        className={cn(
          "flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col h-full bg-zinc-50/50 dark:bg-zinc-900/50 relative z-10 transition-all duration-300 ease-in-out overflow-hidden",
          (sidebarCollapsed || zenMode) ? "w-0 opacity-0 border-none" : "opacity-100"
        )}
        style={{ width: (sidebarCollapsed || zenMode) ? 0 : sidebarWidth }}
      >
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

      {/* Sidebar resize handle */}
      {(!sidebarCollapsed && !zenMode) && (
        <div
          className="w-[3px] cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors flex-shrink-0 z-20"
          onMouseDown={handleSidebarResizeStart}
        />
      )}

      {/* Workspace */}
      <div className="flex-1 overflow-hidden bg-white dark:bg-zinc-950 flex flex-col h-full relative">
        <div
          className="absolute inset-0 z-0 pointer-events-none opacity-[0.03] dark:opacity-[0.05]"
          style={{
            backgroundImage: "radial-gradient(#6366f1 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        {/* Transition for Zen Mode Toolbar */}
        {zenMode && (
          <div className="absolute top-4 right-4 z-[60] flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
            <button
              onClick={() => toggleZenMode(projectId)}
              className={cn(
                "px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 shadow-lg",
                "bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md text-xs font-medium",
                "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all",
                "hover:scale-105 active:scale-95 flex items-center gap-2"
              )}
            >
              <X className="w-3.5 h-3.5" />
              Exit Zen Mode
              <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[10px]">
                Cmd+K Z
              </kbd>
            </button>
          </div>
        )}

        <div className={cn(
          "flex-1 flex flex-col min-h-0 bg-white dark:bg-zinc-950 transition-all duration-500 ease-in-out relative z-10",
          zenMode ? "m-0 rounded-none shadow-none" : ""
        )}>

        {shouldMountEditor ? (
          <WorkspacePaneHost
            projectId={projectId}
            canEdit={canEdit}
            splitEnabled={splitEnabled}
            splitRatio={splitRatio}
            activePane={activePane}
            panes={panes}
            pinnedByTabId={pinnedByTabId}
            tabById={tabById}
            prefs={prefs}
            bottomPanelCollapsed={bottomPanelCollapsed}
            conflictNodeId={conflictDialog.nodeId}
            conflictDiffSignal={conflictDialog.diffSignal}
            activeFilePath={activeFilePath}
            sensors={sensors}
            nodesById={nodesById}
            selectedNodeId={selectedNodeId}
            rootNodes={rootNodes}
            viewMode={viewMode}
            onDragEnd={handleDragEnd}
            onSetActivePane={setActivePane}
            onCloseTab={(paneId, tabId) => void closeTab(paneId, tabId)}
            onPinTab={(paneId, tabId, pinned) => pinTab(projectId, paneId, tabId, pinned)}
            onCloseOthers={(paneId, tabId) => closeOtherTabs(projectId, paneId, tabId)}
            onCloseToRight={(paneId, tabId) => closeTabsToRight(projectId, paneId, tabId)}
            onTabChange={(id, next) => {
              const current = tabByIdRef.current[id];
              if (!current) return;
              // Phase 5: Compare against detached map, not React state
              const currentContent = getFileContent(projectId, id);
              if (currentContent === next) return;
              setDetachedContent(projectId, id, next);
              setFileState(projectId, id, { content: next, isDirty: true });
              setTabById((prev) => ({
                ...prev,
                [id]: {
                  ...prev[id],
                  content: "",
                  contentVersion: (prev[id]?.contentVersion ?? 0) + 1,
                  isDirty: true,
                },
              }));
            }}
            onSaveTab={(id) => void saveTab(id)}
            onRetryLoad={(id) => {
              const node = nodesById[id];
              if (node) void loadFileContent(node);
            }}
            onDeleteTab={(id) => void deleteFile(id)}
            onNavigateToAsset={(node, paneId) => void openFileInPane(node, paneId)}
            onRunActiveFile={() => void runActiveFile()}
            onOpenAsset={(node) => void openFileInPane(node, activePane)}
            onOpenFolderFromGallery={(folderId) => {
              setSelectedNode(projectId, folderId, folderId);
              toggleExpanded(projectId, folderId, true);
            }}
            onStartResize={startResize}
            onToggleBottomPanel={() => toggleBottomPanel(projectId)}
            onOpenQuickOpen={() => {
              setQuickOpenOpen(true);
              setQuickOpenQuery("");
            }}
            onOpenFindInProject={() => setFindOpen(true)}
            onOpenCommandPalette={() => {
              setCommandOpen(true);
              setCommandQuery("");
            }}
            onToggleSplit={() => setSplitEnabled(projectId, !splitEnabled)}
            onToggleLineNumbers={() => setPrefs(projectId, { lineNumbers: !prefs.lineNumbers })}
            onToggleWordWrap={() => setPrefs(projectId, { wordWrap: !prefs.wordWrap })}
            onToggleMinimap={() => setPrefs(projectId, { minimap: !prefs.minimap })}
            onFontSizeDecrease={() =>
              setPrefs(projectId, {
                fontSize: Math.max(12, prefs.fontSize - 1),
              })
            }
            onFontSizeIncrease={() =>
              setPrefs(projectId, {
                fontSize: Math.min(20, prefs.fontSize + 1),
              })
            }
            leftOrderedTabIds={leftOrderedTabIds}
            rightOrderedTabIds={rightOrderedTabIds}
            gitChangedFiles={gitChangedFiles}
          />
        ) : (
          <div className="flex-1 min-h-0 grid place-items-center text-sm text-zinc-500 dark:text-zinc-400">
            Preparing editor...
          </div>
        )}

        <WorkspaceModalsHost
          projectId={projectId}
          canEdit={canEdit}
          activePane={activePane}
          findOpen={findOpen}
          setFindOpen={setFindOpen}
          quickOpenOpen={quickOpenOpen}
          setQuickOpenOpen={setQuickOpenOpen}
          quickOpenQuery={quickOpenQuery}
          setQuickOpenQuery={setQuickOpenQuery}
          quickOpenResults={quickOpenResults}
          nodePathById={nodePathById}
          commandOpen={commandOpen}
          setCommandOpen={setCommandOpen}
          commandQuery={commandQuery}
          setCommandQuery={setCommandQuery}
          filteredCommandActions={filteredCommandActions}
          conflictDialog={conflictDialog}
          setConflictDialog={setConflictDialog}
          getPaneForTab={getPaneForTab}
          setActivePane={setActivePane}
          nodesById={nodesById}
          openFileInPane={openFileInPane}
          ensureNodeMetadata={ensureNodeMetadata}
          loadFileContent={loadFileContent}
          tabByIdRef={tabByIdRef}
        />

        {!zenMode && shouldMountDiagnostics && (
          <WorkspaceBottomPanelHost
            projectId={projectId}
            canEdit={canEdit}
            problems={problems}
            activeFilePath={activeFilePath}
            activePane={activePane}
            activeTabIdByPane={activeTabIdByPane}
            tabById={tabById}
            nodesById={nodesById}
            onRunActiveFile={() => void runActiveFile()}
            onOpenNode={openFileInPane}
          />
        )}

        {!zenMode && (
          <StatusBar
            projectId={projectId}
            projectName={projectName}
            activePane={activePane}
            activeTabId={activeTabIdByPane[activePane] ?? null}
            tabById={tabById}
          />
        )}

        <KeyboardShortcuts open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        </div>
      </div>

      {/* Syncing Overlay */}
      <WorkspaceSyncOverlay
        projectId={projectId}
        initialSyncStatus={initialSyncStatus}
        importSourceType={importSourceType}
        canEdit={canEdit}
        onSyncStateChange={setSyncState}
      />
    </div>
  );
}
