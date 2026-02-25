"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { ProjectNode } from "@/lib/db/schema";
import { useToast } from "@/components/ui-custom/Toast";
const FileExplorer = dynamic(() => import("../explorer/FileExplorer"), { ssr: false });
import { getGitStatus } from "@/app/actions/git";
import { findNodeByPathAny } from "@/app/actions/files";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { FilesViewMode } from "@/stores/filesWorkspaceStore";
import { filesFeatureFlags } from "@/lib/features/files";
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
import { WorkspaceToolbarHost } from "./WorkspaceToolbarHost";
import { WorkspacePaneHost } from "./WorkspacePaneHost";
import { WorkspaceModalsHost } from "./WorkspaceModalsHost";
import { WorkspaceBottomPanelHost } from "./WorkspaceBottomPanelHost";
import { useWorkspaceUiState } from "./useWorkspaceUiState";
import { useWorkspaceLayoutState } from "./useWorkspaceLayoutState";
import { useWorkspacePane } from "./useWorkspacePane";

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
  const { showToast } = useToast();
  const searchParams = useSearchParams();

  // Sync state (received from WorkspaceSyncOverlay via callback)
  const [syncState, setSyncState] = useState(initialSyncStatus);

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
  const toggleBottomPanel = useFilesWorkspaceStore((s) => s.toggleBottomPanel);
  const setBottomPanelTab = useFilesWorkspaceStore((s) => s.setBottomPanelTab);
  const setLastExecutionOutput = useFilesWorkspaceStore((s) => s.setLastExecutionOutput);
  const setLastExecutionSettingsHref = useFilesWorkspaceStore((s) => s.setLastExecutionSettingsHref);
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
    headerSearchOpen,
    setHeaderSearchOpen,
    headerSearchQuery,
    setHeaderSearchQuery,
    recentFileIds,
    setRecentFileIds,
  } = useWorkspaceUiState();

  // Tab manager
  const {
    conflictDialog,
    setConflictDialog,
    dirtyTabIds,
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
    handleSaveAllDirtyTabs,
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
    if (!tab?.content) return;

    if (bottomPanelCollapsed) toggleBottomPanel(projectId);
    setBottomPanelTab(projectId, "output");

    const stdinText = useFilesWorkspaceStore.getState()._get(projectId).ui.stdinInputText;
    const stdinLines = stdinText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const result = await runFileWithContent(projectId, activeFilePath, tab.content, {
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

    void (async () => {
      try {
        const node = await findNodeByPathAny(projectId, normalizedPath);
        if (!node) return;
        if (node.type === "folder") {
          setSelectedNode(projectId, node.id, node.parentId ?? null);
          toggleExpanded(projectId, node.id, true);
          return;
        }
        await openFileInPane(node, "left");
        setSelectedNode(projectId, node.id, node.parentId ?? null);
        if (line) {
          requestScrollTo(projectId, node.id, line);
        }
      } catch (error) {
        console.error("Failed to open files deep link", error);
      }
    })();
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
    canEdit,
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
    canEdit,
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
  const handleKeyboardCloseQuickOpen = useCallback(() => setQuickOpenOpen(false), [setQuickOpenOpen]);
  const handleKeyboardCloseCommand = useCallback(() => setCommandOpen(false), [setCommandOpen]);

  useWorkspaceKeyboard({
    onQuickOpen: handleKeyboardQuickOpen,
    onCommandPalette: handleKeyboardCommandPalette,
    onFindInProject: handleKeyboardFindInProject,
    quickOpenOpen,
    commandOpen,
    onCloseQuickOpen: handleKeyboardCloseQuickOpen,
    onCloseCommand: handleKeyboardCloseCommand,
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
    if (!filesFeatureFlags.wave4GitIntegration || gitBootstrapRef.current.has(projectId))
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
      ] as Array<{ id: string; label: string; run: () => void }>,
    [
      activeFilePath,
      bottomPanelCollapsed,
      projectId,
      runActiveFile,
      setFindOpen,
      setSplitEnabled,
      setViewMode,
      splitEnabled,
      toggleBottomPanel,
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

        <WorkspaceToolbarHost
          projectId={projectId}
          canEdit={canEdit}
          viewMode={viewMode}
          splitEnabled={splitEnabled}
          bottomPanelCollapsed={bottomPanelCollapsed}
          headerSearchOpen={headerSearchOpen}
          headerSearchQuery={headerSearchQuery}
          dirtyTabIds={dirtyTabIds}
          wave1SaveAllEnabled={filesFeatureFlags.wave1SaveAll}
          onToggleHeaderSearch={() => {
            setHeaderSearchOpen((prev) => !prev);
            if (headerSearchOpen) setHeaderSearchQuery("");
          }}
          onHeaderSearchQueryChange={setHeaderSearchQuery}
          onHeaderSearchKeyDown={(e) => {
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
          onSaveAllDirtyTabs={() => void handleSaveAllDirtyTabs()}
          onSetViewMode={(mode) => setViewMode(projectId, mode)}
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
          prefs={prefs}
        />

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
            if (!current || current.content === next) return;
            setFileState(projectId, id, { content: next, isDirty: true });
            setTabById((prev) => ({
              ...prev,
              [id]: { ...prev[id], content: next, isDirty: true },
            }));
          }}
          onSaveTab={(id) => void saveTab(id)}
          onRetryLoad={(id) => {
            const node = nodesById[id];
            if (node) void loadFileContent(node);
          }}
          onDeleteTab={(id) => void deleteFile(id)}
          onCrumbClick={(folderId) => {
            setSelectedNode(projectId, folderId, folderId);
            toggleExpanded(projectId, folderId, true);
          }}
          onNavigatePathNode={(node, paneId) => void openFileInPane(node, paneId)}
          onNavigateToAsset={(node, paneId) => void openFileInPane(node, paneId)}
          onRunActiveFile={() => void runActiveFile()}
          onOpenAsset={(node) => void openFileInPane(node, activePane)}
          onOpenFolderFromGallery={(folderId) => {
            setSelectedNode(projectId, folderId, folderId);
            toggleExpanded(projectId, folderId, true);
          }}
          onStartResize={startResize}
          leftOrderedTabIds={leftOrderedTabIds}
          rightOrderedTabIds={rightOrderedTabIds}
        />

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
