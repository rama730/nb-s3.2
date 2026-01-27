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
  FileCode,
  FileImage,
  MoreVertical,
  Pin,
  PinOff,
  SplitSquareVertical,
  X,
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
} from "@/app/actions/files";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

interface ProjectFilesWorkspaceProps {
  projectId: string;
  projectName?: string;
  currentUserId?: string;
  isOwnerOrMember: boolean;
}

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
}: ProjectFilesWorkspaceProps) {
  const canEdit = isOwnerOrMember;
  const { showToast } = useToast();

  const ws = useFilesWorkspaceStore((s) => s._get(projectId));
  const openTab = useFilesWorkspaceStore((s) => s.openTab);
  const closeTabStore = useFilesWorkspaceStore((s) => s.closeTab);
  const pinTab = useFilesWorkspaceStore((s) => s.pinTab);
  const closeOtherTabs = useFilesWorkspaceStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useFilesWorkspaceStore((s) => s.closeTabsToRight);
  const setSplitEnabled = useFilesWorkspaceStore((s) => s.setSplitEnabled);
  const setSplitRatio = useFilesWorkspaceStore((s) => s.setSplitRatio);
  const setPrefs = useFilesWorkspaceStore((s) => s.setPrefs);
  const removeNodeFromCaches = useFilesWorkspaceStore((s) => s.removeNodeFromCaches);
  const setLock = useFilesWorkspaceStore((s) => s.setLock);
  const clearLock = useFilesWorkspaceStore((s) => s.clearLock);
  const setSelectedNode = useFilesWorkspaceStore((s) => s.setSelectedNode);
  const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);
  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);

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

  const panesToRender: PaneId[] = ws.splitEnabled ? ["left", "right"] : ["left"];

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findLoading, setFindLoading] = useState(false);
  const [findResults, setFindResults] = useState<Array<{ nodeId: string; snippet: string }>>([]);

  const ensureNodeMetadata = useCallback(
    async (nodeIds: string[]) => {
      const missing = nodeIds.filter((id) => !ws.nodesById[id]);
      if (missing.length === 0) return;
      const nodes = (await getNodesByIds(projectId, missing)) as ProjectNode[];
      upsertNodes(projectId, nodes);
    },
    [projectId, upsertNodes, ws.nodesById]
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
          isLoading: true,
          error: null,
        },
      }));

      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.storage.from("project-files").download(node.s3Key);
        if (error) throw error;
        const text = await data.text();
        const latestToken = loadTokenRef.current.get(node.id);
        if (latestToken !== nextToken) return;

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
      }
    },
    [getSupabase]
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

      if (!tabByIdRef.current[node.id]) {
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
          },
        }));
        await loadFileContent(node);
      }

      await acquireLockForNode(node);
    },
    [acquireLockForNode, activePane, loadFileContent, openTab, projectId, setSelectedNode]
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
    [canEdit, getSupabase, projectId, showToast]
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

  // Restore / ensure metadata + content for persisted tabs
  useEffect(() => {
    const allOpenIds = Array.from(
      new Set([...ws.panes.left.openTabIds, ...ws.panes.right.openTabIds])
    );
    if (allOpenIds.length === 0) return;

    void (async () => {
      await ensureNodeMetadata(allOpenIds);
      for (const id of allOpenIds) {
        const node = ws.nodesById[id];
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
            },
          }));
          await loadFileContent(node);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, ws.panes.left.openTabIds.join(","), ws.panes.right.openTabIds.join(",")]);

  // Save previous active tab on switch, per pane (best-effort)
  useEffect(() => {
    for (const paneId of panesToRender) {
      const prev = prevActiveRef.current[paneId];
      const current = ws.panes[paneId].activeTabId;
      if (prev && prev !== current) {
        const prevTab = tabByIdRef.current[prev];
        if (prevTab?.isDirty && canEdit) void saveTab(prev, { silent: true, reason: "switch" });
      }
      prevActiveRef.current[paneId] = current;
    }
  }, [canEdit, panesToRender, saveTab, ws.panes.left.activeTabId, ws.panes.right.activeTabId]);

  // Ensure active tabs attempt to acquire a lock
  useEffect(() => {
    if (!currentUserId) return;
    for (const paneId of panesToRender) {
      const id = ws.panes[paneId].activeTabId;
      if (!id) continue;
      const tab = tabById[id];
      if (!tab) continue;
      if (tab.hasLock) continue;
      if (!canEdit) continue;
      void acquireLockForNode(tab.node);
    }
  }, [acquireLockForNode, canEdit, currentUserId, panesToRender, tabById, ws.panes.left.activeTabId, ws.panes.right.activeTabId]);

  // Debounced autosave per pane active tab
  useEffect(() => {
    for (const paneId of panesToRender) {
      if (autosaveTimerRef.current[paneId]) clearTimeout(autosaveTimerRef.current[paneId]!);
      const id = ws.panes[paneId].activeTabId;
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
  }, [canEdit, panesToRender, saveTab, tabById, ws.panes.left.activeTabId, ws.panes.right.activeTabId]);

  // Keepalive for active locks
  useEffect(() => {
    if (!currentUserId) return;
    const interval = setInterval(() => {
      for (const paneId of panesToRender) {
        const id = ws.panes[paneId].activeTabId;
        if (!id) continue;
        const tab = tabByIdRef.current[id];
        if (!tab?.hasLock) continue;
        void refreshProjectNodeLock(projectId, id, 120);
      }
    }, 45_000);
    return () => clearInterval(interval);
  }, [currentUserId, panesToRender, projectId, ws.panes.left.activeTabId, ws.panes.right.activeTabId]);

  // Flush offline queue when back online
  useEffect(() => {
    const onOnline = () => {
      try {
        const key = `files-offline-queue:${projectId}`;
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const queue = JSON.parse(raw) as Record<string, { content: string; ts: number }>;
        const ids = Object.keys(queue);
        if (!ids.length) return;
        void (async () => {
          await ensureNodeMetadata(ids);
          for (const id of ids) {
            const node = ws.nodesById[id];
            if (!node) continue;
            // Ensure tab state exists / reflects queued content
            setTabById((prev) => ({
              ...prev,
              [id]: {
                ...(prev[id] ?? {
                  id,
                  node,
                  content: queue[id].content,
                  savedSnapshot: "",
                  isDirty: true,
                  isLoading: false,
                  isSaving: false,
                  isDeleting: false,
                  hasLock: false,
                  lockInfo: null,
                  offlineQueued: true,
                  error: null,
                }),
                node,
                content: queue[id].content,
                isDirty: true,
                offlineQueued: true,
              },
            }));

            await acquireLockForNode(node);
            await saveTab(id, { silent: true, reason: "offline-flush" });
          }
        })();
      } catch {}
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [acquireLockForNode, ensureNodeMetadata, projectId, saveTab, ws.nodesById]);

  const startResize = (e: React.MouseEvent) => {
    if (!ws.splitEnabled) return;
    e.preventDefault();
    const startX = e.clientX;
    const startRatio = ws.splitRatio;
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
    ws.panes.left.openTabIds.length === 0 && (!ws.splitEnabled || ws.panes.right.openTabIds.length === 0);

  return (
    <div className="min-h-[70vh] h-[calc(100vh-220px)] flex bg-white dark:bg-zinc-950 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm relative isolate">
      {/* Explorer */}
      <div className="w-[320px] flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col h-full bg-zinc-50/50 dark:bg-zinc-900/50 relative z-10">
        <FileExplorer
          projectId={projectId}
          projectName={projectName}
          canEdit={canEdit}
          onOpenFile={(node) => void openFileInPane(node)}
          onNodeDeleted={(nodeId) => removeNodeFromCaches(projectId, nodeId)}
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
                  onClick={() => setPrefs(projectId, { lineNumbers: !ws.prefs.lineNumbers })}
                >
                  {ws.prefs.lineNumbers ? "Hide" : "Show"} line numbers
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setPrefs(projectId, { wordWrap: !ws.prefs.wordWrap })}
                >
                  {ws.prefs.wordWrap ? "Disable" : "Enable"} word wrap
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setPrefs(projectId, { minimap: !ws.prefs.minimap })}
                >
                  {ws.prefs.minimap ? "Hide" : "Show"} minimap
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setPrefs(projectId, { fontSize: Math.max(12, ws.prefs.fontSize - 1) })}
                >
                  Font size: -
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setPrefs(projectId, { fontSize: Math.min(20, ws.prefs.fontSize + 1) })}
                >
                  Font size: +
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => setSplitEnabled(projectId, !ws.splitEnabled)}
            >
              <SplitSquareVertical className="w-4 h-4 mr-2" />
              {ws.splitEnabled ? "Single" : "Split"}
            </Button>
          </div>
        </div>

        <div className="relative z-10 flex-1 overflow-hidden flex">
          <Pane
            projectId={projectId}
            paneId="left"
            canEdit={canEdit}
            width={ws.splitEnabled ? `${ws.splitRatio * 100}%` : "100%"}
            tabIds={orderedTabIds(ws.panes.left.openTabIds, ws.pinnedByTabId)}
            activeTabId={ws.panes.left.activeTabId}
            pinnedById={ws.pinnedByTabId}
            tabById={tabById}
            prefs={ws.prefs}
            setActivePane={() => setActivePane("left")}
            setActiveTab={(id) => useFilesWorkspaceStore.getState().setActiveTab(projectId, "left", id)}
            onCloseTab={(id) => void closeTab("left", id)}
            onPinTab={(id, pinned) => pinTab(projectId, "left", id, pinned)}
            onCloseOthers={(id) => closeOtherTabs(projectId, "left", id)}
            onCloseToRight={(id) => closeTabsToRight(projectId, "left", id)}
            onChange={(id, next) =>
              setTabById((prev) => ({ ...prev, [id]: { ...prev[id], content: next, isDirty: true } }))
            }
            onSave={(id) => void saveTab(id)}
            onRetryLoad={(id) => {
              const node = ws.nodesById[id];
              if (node) void loadFileContent(node);
            }}
            onDelete={(id) => void deleteFile(id)}
            onCrumbClick={(folderId) => {
              setSelectedNode(projectId, folderId, folderId);
              toggleExpanded(projectId, folderId, true);
            }}
            onNavigatePathNode={(node) => void openFileInPane(node, "left")}
          />

          {ws.splitEnabled ? (
            <div
              className="w-1 cursor-col-resize bg-zinc-200 dark:bg-zinc-800 hover:bg-indigo-300 dark:hover:bg-indigo-700 transition-colors"
              onMouseDown={startResize}
              aria-label="Resize split"
            />
          ) : null}

          {ws.splitEnabled ? (
            <Pane
              projectId={projectId}
              paneId="right"
              canEdit={canEdit}
              width={`${(1 - ws.splitRatio) * 100}%`}
              tabIds={orderedTabIds(ws.panes.right.openTabIds, ws.pinnedByTabId)}
              activeTabId={ws.panes.right.activeTabId}
              pinnedById={ws.pinnedByTabId}
              tabById={tabById}
            prefs={ws.prefs}
              setActivePane={() => setActivePane("right")}
              setActiveTab={(id) => useFilesWorkspaceStore.getState().setActiveTab(projectId, "right", id)}
              onCloseTab={(id) => void closeTab("right", id)}
              onPinTab={(id, pinned) => pinTab(projectId, "right", id, pinned)}
              onCloseOthers={(id) => closeOtherTabs(projectId, "right", id)}
              onCloseToRight={(id) => closeTabsToRight(projectId, "right", id)}
              onChange={(id, next) =>
                setTabById((prev) => ({ ...prev, [id]: { ...prev[id], content: next, isDirty: true } }))
              }
              onSave={(id) => void saveTab(id)}
              onRetryLoad={(id) => {
                const node = ws.nodesById[id];
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
                        const node = ws.nodesById[r.nodeId];
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
              <div
                key={id}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                  isActive
                    ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                    : "bg-transparent border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                )}
                title={name}
              >
                <button
                  className="truncate max-w-[160px] text-left"
                  onClick={() => setActiveTab(id)}
                >
                  {name}
                </button>
                {isDirty ? <span className="w-2 h-2 rounded-full bg-amber-500" /> : null}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60">
                      <MoreVertical className="w-3 h-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onPinTab(id, !pinned)}>
                      {pinned ? <PinOff className="w-4 h-4 mr-2" /> : <Pin className="w-4 h-4 mr-2" />}
                      {pinned ? "Unpin" : "Pin"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onCloseToRight(id)}>
                      Close to right
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onCloseOthers(id)}>
                      Close others
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onCloseTab(id)}>
                      Close
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <button
                  className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
                  onClick={() => onCloseTab(id)}
                  aria-label="Close tab"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })
        )}
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
      <div className="flex-1 overflow-hidden">
        {activeTab ? (
          activeTab.node.mimeType?.startsWith("image/") ? (
            <div className="flex flex-col h-full items-center justify-center p-8 text-center">
              <div className="w-24 h-24 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
                <FileImage className="w-10 h-10 text-zinc-400" />
              </div>
              <h3 className="text-lg font-medium">Image Preview</h3>
              <p className="text-zinc-500 text-sm mt-2">{activeTab.node.name}</p>
            </div>
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

function BreadcrumbBar({
  projectId,
  node,
  onCrumbClick,
  onNavigateNode,
}: {
  projectId: string;
  node: ProjectNode | null;
  onCrumbClick: (folderId: string) => void;
  onNavigateNode: (node: ProjectNode) => void;
}) {
  const [crumbs, setCrumbs] = useState<Array<{ id: string; name: string; parentId: string | null }>>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [pathInput, setPathInput] = useState("");

  useEffect(() => {
    const folderId = node?.type === "file" ? node.parentId ?? null : node?.id ?? null;
    if (!folderId) {
      setCrumbs([]);
      return;
    }
    void (async () => {
      const data = (await getBreadcrumbs(projectId, folderId)) as any[];
      setCrumbs(
        (data || []).map((c) => ({
          id: c.id,
          name: c.name,
          parentId: c.parentId ?? null,
        }))
      );
    })();
  }, [projectId, node?.id, node?.parentId, node?.type]);

  return (
    <div
      className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 overflow-x-auto"
      onDoubleClick={() => {
        const currentPath = crumbs.map((c) => c.name).join("/");
        setPathInput(currentPath);
        setIsEditing(true);
      }}
      title="Double-click to type a path"
    >
      <span className="font-semibold text-zinc-700 dark:text-zinc-200">Path</span>
      <span className="text-zinc-400">/</span>

      {isEditing ? (
        <input
          className="h-6 px-2 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 outline-none"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          autoFocus
          onBlur={() => setIsEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setIsEditing(false);
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              const parts = pathInput
                .split("/")
                .map((p) => p.trim())
                .filter(Boolean);
              void (async () => {
                const found = (await findNodeByPathAny(projectId, parts)) as ProjectNode | null;
                if (found) {
                  if (found.type === "folder") onCrumbClick(found.id);
                  else onNavigateNode(found);
                }
                setIsEditing(false);
              })();
            }
          }}
        />
      ) : crumbs.length === 0 ? (
        <span className="text-zinc-400">Root</span>
      ) : (
        crumbs.map((c, idx) => (
          <React.Fragment key={c.id}>
            <button
              className="hover:underline text-zinc-700 dark:text-zinc-200"
              onClick={() => onCrumbClick(c.id)}
            >
              {c.name}
            </button>
            {idx < crumbs.length - 1 ? <span className="text-zinc-400">/</span> : null}
          </React.Fragment>
        ))
      )}
    </div>
  );
}

