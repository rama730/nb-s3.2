"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, VirtuosoGrid } from "react-virtuoso";
import { FileGridItem } from "./FileGridItem";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Folder,
  FolderOpen,
  List,
  Loader2,
  Link2,
  MoreHorizontal,
  Search,
  ShieldCheck,
  ShieldX,
  Star,
  Trash2,
  Undo2,
} from "lucide-react";
import { FileTreeItem } from "./FileTreeItem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui-custom/Toast";
import { createClient } from "@/lib/supabase/client";
import type { ProjectNode } from "@/lib/db/schema"; // Fixed
import {
  bulkMoveNodes,
  bulkRestoreNodes,
  bulkTrashNodes,
  createFolder,
  createFileNode,
  getNodeActivity,
  getNodeLinkedTasks,
  getNodesByIds,
  getProjectNodes,
  getProjectBatchNodes, // NEW
  getTrashNodes,
  renameNode,
  searchProjectNodesFederated,
  getTaskLinkCounts,
} from "@/app/actions/files";
import { filesParentKey, useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { FilesViewMode } from "@/stores/filesWorkspaceStore";
import { isAssetLike, isTextLike } from "../utils/fileKind";
import OutlinePanel from "./OutlinePanel";
import SourceControlPanel from "./SourceControlPanel";

const EMPTY_OBJECT = {};
const EMPTY_ARRAY: string[] = [];

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function areIdListsEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

type AssetGridListProps = React.HTMLAttributes<HTMLDivElement> & { style?: React.CSSProperties };

const AssetGridList = React.forwardRef<HTMLDivElement, AssetGridListProps>(function AssetGridList(
  { style, children, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      {...props}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
        gap: "8px",
        padding: "8px",
        ...style,
      }}
    >
      {children}
    </div>
  );
});

AssetGridList.displayName = "AssetGridList";

const AssetGridItem = ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div {...props} style={{ padding: 0 }}>
    {children}
  </div>
);

AssetGridItem.displayName = "AssetGridItem";

export type VisibleRow =
  | { kind: "node"; nodeId: string; level: number; parentId: string | null; indentationGuides: boolean[] }
  | { kind: "loading"; parentId: string; level: number; indentationGuides: boolean[] }
  | { kind: "load-more"; parentId: string; level: number; indentationGuides: boolean[] } // NEW
  | { kind: "empty"; level: number };

type ExplorerOperation = {
  id: string;
  label: string;
  status: "success" | "error" | "running";
  at: number;
  undo?: { label: string; run: () => Promise<void> };
};

function formatBytes(bytes?: number | null) {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function buildVisibleRows(args: {
  nodesById: Record<string, ProjectNode>;
  childrenByParentId: Record<string, string[]>;
  loadedChildren: Record<string, boolean>;
  expandedFolderIds: Record<string, boolean>;
  folderMeta: Record<string, { nextCursor: string | null; hasMore: boolean }>;
  sort: "name" | "updated" | "type";
  foldersFirst: boolean;
  includeNode?: (node: ProjectNode) => boolean;
}): VisibleRow[] {
  const {
    nodesById,
    childrenByParentId,
    loadedChildren,
    expandedFolderIds,
    folderMeta,
    sort,
    foldersFirst,
    includeNode,
  } = args;

  const sortIds = (ids: string[]) => {
    const nodes = ids.map((id) => nodesById[id]).filter(Boolean);

    const cmp = (a: ProjectNode, b: ProjectNode) => {
      if (foldersFirst && a.type !== b.type) return a.type === "folder" ? -1 : 1;
      if (sort === "updated") return b.updatedAt.getTime() - a.updatedAt.getTime();
      if (sort === "type") return (a.mimeType || "").localeCompare(b.mimeType || "");
      return a.name.localeCompare(b.name);
    };

    return nodes.sort(cmp).map((n) => n.id);
  };

  const rows: VisibleRow[] = [];

  const walk = (parentId: string | null, level: number, ancestors: boolean[]) => {
    const key = filesParentKey(parentId);
    const childIds = childrenByParentId[key] || [];
    const sorted = sortIds(childIds).filter((id) => {
      const n = nodesById[id];
      if (!n) return false;
      return includeNode ? includeNode(n) : true;
    });

    if (level === 0 && sorted.length === 0) {
      rows.push({ kind: "empty", level: 0 });
      return;
    }

    for (let i = 0; i < sorted.length; i++) {
        const id = sorted[i];
        
        // Check if this is the absolute last item in this folder's list (including potential "load more" button)
        // If there is "hasMore", then the last file is NOT the last item of the folder visually.
        const meta = folderMeta[filesParentKey(parentId)];
        const hasMore = !!meta?.hasMore;
        
        // If hasMore is true, then NONE of the files are the "last" visually, because the "Load More" button comes after.
        // So isLast is false for all files if hasMore is true.
        // If hasMore is false, then the last file isLast.
        const isLastFile = i === sorted.length - 1;
        const isVisuallyLastInfo = hasMore ? false : isLastFile;
        
        rows.push({ kind: "node", nodeId: id, level, parentId, indentationGuides: ancestors });
        
        const node = nodesById[id];
        if (node?.type === "folder" && expandedFolderIds[id]) {
            const childKey = filesParentKey(id);
            const loaded = !!loadedChildren[childKey];
            
            // For children, we need to pass down the line status of THIS node.
            // If this node is NOT visually last (e.g. invalidates line), we pass true (draw line).
            const nextAncestors = [...ancestors, !isVisuallyLastInfo];
            
            if (!loaded) {
                rows.push({ kind: "loading", parentId: id, level: level + 1, indentationGuides: nextAncestors });
            } else {
                walk(id, level + 1, nextAncestors);
            }
        }
    }
    
    // Append "Load More" if needed
    const meta = folderMeta[filesParentKey(parentId)];
    if (meta?.hasMore) {
        // The "Load More" button is the last item visually.
        // It shares the same ancestors as the files.
        // But what about the line from the *parent* to this button?
        // The parent determines the indentation guides.
        rows.push({ kind: "load-more", parentId: parentId ?? "root", level, indentationGuides: ancestors });
    }
  };

  walk(null, 0, []);
  return rows;
}

export default function FileExplorer({
  projectId,
  projectName,
  canEdit,
  viewMode = "code",
  onOpenFile,
  onNodeDeleted,
  mode = "default",
  selectedNodeIds = [],
  onSelectionChange,
  syncStatus,
}: {
  projectId: string;
  projectName?: string;
  canEdit: boolean;
  viewMode?: FilesViewMode;
  onOpenFile: (node: ProjectNode) => void;
  onNodeDeleted?: (nodeId: string) => void;
  mode?: "default" | "select";
  selectedNodeIds?: string[];
  onSelectionChange?: (nodeIds: string[]) => void;
  syncStatus?: string;
}) {
  const { showToast } = useToast();
  const [accessError, setAccessError] = useState<string | null>(null);


  // Granular selectors for performance (avoid re-rendering tree on file content changes)
  const nodesById = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.nodesById || EMPTY_OBJECT);
  const childrenByParentId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.childrenByParentId || EMPTY_OBJECT);
  const loadedChildren = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.loadedChildren || EMPTY_OBJECT);
  const expandedFolderIds = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.expandedFolderIds || EMPTY_OBJECT);
  const folderMeta = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.folderMeta || EMPTY_OBJECT); // NEW
  const explorerMode = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.explorerMode || "tree");
  const searchQuery = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.searchQuery || "");
  const favorites = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.favorites || EMPTY_OBJECT);
  const recents = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.recents || EMPTY_ARRAY);
  const savedViews = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.savedViews || EMPTY_ARRAY);
  const sort = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.sort || "name");
  const foldersFirst = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.foldersFirst || true);
  const selectedNodeId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.selectedNodeId);
  const storeSelectedNodeIds = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.selectedNodeIds || EMPTY_ARRAY);
  const selectedFolderId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.selectedFolderId);
  const taskLinkCounts = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.taskLinkCounts || EMPTY_OBJECT);

  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);
  const setChildren = useFilesWorkspaceStore((s) => s.setChildren);
  const markChildrenLoaded = useFilesWorkspaceStore((s) => s.markChildrenLoaded);
  const setFolderMeta = useFilesWorkspaceStore((s) => s.setFolderMeta); // NEW
  const setSelectedNode = useFilesWorkspaceStore((s) => s.setSelectedNode);
  const setSelectedNodeIds = useFilesWorkspaceStore((s) => s.setSelectedNodeIds);
  const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);
  const setSearchQuery = useFilesWorkspaceStore((s) => s.setSearchQuery);
  const setSort = useFilesWorkspaceStore((s) => s.setSort);
  const addRecent = useFilesWorkspaceStore((s) => s.addRecent);
  const toggleFavorite = useFilesWorkspaceStore((s) => s.toggleFavorite);
  const saveCurrentView = useFilesWorkspaceStore((s) => s.saveCurrentView);
  const applySavedView = useFilesWorkspaceStore((s) => s.applySavedView);
  const deleteSavedView = useFilesWorkspaceStore((s) => s.deleteSavedView);
  const setTaskLinkCounts = useFilesWorkspaceStore((s) => s.setTaskLinkCounts);
  const setExplorerMode = useFilesWorkspaceStore((s) => s.setExplorerMode);
  const setViewMode = useFilesWorkspaceStore((s) => s.setViewMode);

  const isSelectionMode = mode === "select";
  const controlledSelectedNodeIds = useMemo(
    () => Array.from(new Set(selectedNodeIds)),
    [selectedNodeIds]
  );
  const effectiveSelectedNodeIds = isSelectionMode ? controlledSelectedNodeIds : storeSelectedNodeIds;
  const uploadEnabled = !isSelectionMode;
  const nestedDialogClassName = isSelectionMode ? "z-[360]" : undefined;
  const nestedDialogOverlayClassName = isSelectionMode ? "z-[350]" : undefined;

  useEffect(() => {
    if (!isSelectionMode) return;
    const currentSelected =
      useFilesWorkspaceStore.getState().byProjectId[projectId]?.selectedNodeIds || [];
    if (areIdListsEqual(currentSelected, controlledSelectedNodeIds)) return;
    setSelectedNodeIds(projectId, controlledSelectedNodeIds);
  }, [isSelectionMode, projectId, controlledSelectedNodeIds, setSelectedNodeIds]);

  // ... (existing state) ...



  // ... (rest of render) ...






  const [isBooting, setIsBooting] = useState(true);
  
  const [createDialog, setCreateDialog] = useState<
    | { open: false }
    | { open: true; kind: "file" | "folder"; parentId: string | null; name: string }
  >({ open: false });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; nodes: ProjectNode[] }>({
    open: false,
    nodes: [],
  });
  const [moveDialog, setMoveDialog] = useState<{
    open: boolean;
    nodes: ProjectNode[];
    targetFolderId: string | null;
  }>({ open: false, nodes: [], targetFolderId: null });
  const [renameState, setRenameState] = useState<{
    nodeId: string | null;
    value: string;
    original: string;
  }>({ nodeId: null, value: "", original: "" });

  const [quickOpen, setQuickOpen] = useState<{ open: boolean; query: string }>({
    open: false,
    query: "",
  });
  const [quickOpenResults, setQuickOpenResults] = useState<ProjectNode[]>([]);
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);

  const [commandPalette, setCommandPalette] = useState<{ open: boolean; query: string }>({
    open: false,
    query: "",
  });
  const [selectedSavedViewId, setSelectedSavedViewId] = useState<string>("");
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [operations, setOperations] = useState<ExplorerOperation[]>([]);
  const [inlineSearchOpen, setInlineSearchOpen] = useState(false);
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const [linkedTasks, setLinkedTasks] = useState<
    Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
      taskNumber: number | null;
      dueDate: number | null;
      linkedAt: number;
    }>
  >([]);
  const [nodeActivity, setNodeActivity] = useState<
    Array<{
      id: string;
      type: string;
      at: number;
      by: string | null;
      metadata: Record<string, unknown> | null;
    }>
  >([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  
  const [isOutlineOpen, setIsOutlineOpen] = useState(false);
  const [isSourceControlOpen, setIsSourceControlOpen] = useState(false);
  // Removed duplicate accessError

  const bootedRef = useRef(false);
  const batchLoadedRef = useRef(false);
  const folderLoadInFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  const searchRequestIdRef = useRef(0);
  const quickOpenRequestIdRef = useRef(0);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mutationInFlightKeysRef = useRef<Set<string>>(new Set());
  const prefetchedFolderKeysRef = useRef<Set<string>>(new Set());
  const searchSnippetsRef = useRef<Record<string, string | null>>({});

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const getSupabase = useCallback(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }, []);

  const runInMutationQueue = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = mutationQueueRef.current.then(fn, fn);
    mutationQueueRef.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }, []);

  const runUniqueMutation = useCallback(
    async <T,>(key: string, fn: () => Promise<T>): Promise<T | null> => {
      if (mutationInFlightKeysRef.current.has(key)) return null;
      mutationInFlightKeysRef.current.add(key);
      try {
        return await runInMutationQueue(fn);
      } finally {
        mutationInFlightKeysRef.current.delete(key);
      }
    },
    [runInMutationQueue]
  );

  const recordOperation = useCallback((operation: Omit<ExplorerOperation, "id" | "at">) => {
    const entry: ExplorerOperation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      ...operation,
    };
    setOperations((prev) => [entry, ...prev].slice(0, 30));
  }, []);

  const executeUndo = useCallback(
    async (operationId: string) => {
      const operation = operations.find((entry) => entry.id === operationId);
      if (!operation?.undo) return;
      setOperations((prev) =>
        prev.map((entry) =>
          entry.id === operationId ? { ...entry, status: "running" } : entry
        )
      );
      try {
        await operation.undo.run();
        setOperations((prev) =>
          prev.map((entry) =>
            entry.id === operationId
              ? { ...entry, status: "success", undo: undefined, label: `${entry.label} (undone)` }
              : entry
          )
        );
      } catch (error: unknown) {
        setOperations((prev) =>
          prev.map((entry) =>
            entry.id === operationId
              ? { ...entry, status: "error", label: `${entry.label} (undo failed)` }
              : entry
          )
        );
        showToast(`Undo failed: ${getErrorMessage(error, "Unknown error")}`, "error");
      }
    },
    [operations, showToast]
  );

  // --- Scalable Data Fetching Logic ---

  // Unified Folder Loader (Refresh or Append)
  const loadFolderContent = useCallback(async (parentId: string | null, mode: 'refresh' | 'append' = 'append') => {
      const requestKey = `${filesParentKey(parentId)}::${mode}`;
      const inFlight = folderLoadInFlightRef.current.get(requestKey);
      if (inFlight) {
        await inFlight;
        return;
      }

      const task = (async () => {
        const startedAt = performance.now();
        try {
          const key = filesParentKey(parentId);
          const currentWs = useFilesWorkspaceStore.getState().byProjectId[projectId];

          let cursor: string | undefined = undefined;
          const limit = 100;

          if (mode === "append") {
            const meta = currentWs?.folderMeta?.[key];
            cursor = meta?.nextCursor || undefined;
            if (!cursor) return;
          }

          setAccessError(null);

          const res = await getProjectNodes(projectId, parentId, undefined, limit, cursor) as {
            nodes: ProjectNode[];
            nextCursor: string | null;
          };
          const newNodes = Array.isArray(res) ? res : res.nodes;
          const nextCursor = !Array.isArray(res) ? res.nextCursor : null;

          if (newNodes.length > 0) {
            upsertNodes(projectId, newNodes);
          }

          if (mode === "refresh") {
            setChildren(projectId, parentId, newNodes.map((n) => n.id));
          } else {
            const latestWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
            const currentChildrenIds = latestWs?.childrenByParentId?.[key] || [];
            const nextIds = Array.from(new Set([...currentChildrenIds, ...newNodes.map((n) => n.id)]));
            setChildren(projectId, parentId, nextIds);
          }
          setFolderMeta(projectId, parentId, { nextCursor, hasMore: !!nextCursor });
          markChildrenLoaded(projectId, parentId);

          // One-page prefetch for hot folders to reduce first scroll latency.
          if (mode === "refresh" && nextCursor && parentId && expandedFolderIds[parentId]) {
            const prefetchKey = filesParentKey(parentId);
            if (!prefetchedFolderKeysRef.current.has(prefetchKey)) {
              prefetchedFolderKeysRef.current.add(prefetchKey);
              queueMicrotask(() => {
                void loadFolderContent(parentId, "append");
              });
            }
          }

          const fileIds = newNodes.filter((n) => n.type === "file").map((n) => n.id);
          if (fileIds.length > 0) {
            const counts = await getTaskLinkCounts(projectId, fileIds);
            setTaskLinkCounts(projectId, counts);
          }
        } catch (e: unknown) {
          console.error("Load folder failed", e);
          if (mode === "refresh") {
            setAccessError(getErrorMessage(e, "Failed to load files"));
          } else {
            showToast("Failed to load more files", "error");
          }
        } finally {
          if (process.env.NODE_ENV !== "production") {
            const elapsedMs = Math.round(performance.now() - startedAt);
            console.debug("[files] loadFolderContent", {
              projectId,
              parentId: parentId ?? "root",
              mode,
              elapsedMs,
            });
          }
          folderLoadInFlightRef.current.delete(requestKey);
        }
      })();

      folderLoadInFlightRef.current.set(requestKey, task);
      await task;
  }, [projectId, upsertNodes, setChildren, markChildrenLoaded, setFolderMeta, setTaskLinkCounts, showToast, expandedFolderIds]);

  // 1. Root Boot (Initial Load - Light O(1))
  const boot = useCallback(async () => {
    // Only fetch root if we haven't blindly loaded it yet.
    const key = filesParentKey(null);
    const currentWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
    const alreadyLoaded = currentWs?.loadedChildren?.[key];
    
    if (!bootedRef.current && !alreadyLoaded) {
        bootedRef.current = true;
        // reuse loadFolderContent
        await loadFolderContent(null, 'refresh');
        
        // Auto-expand system root check needs nodes... 
        // We can do it by peeking store after load?
        // Or just re-implement simple check here.
        // Let's keep boot simple and manual for now, or just let loadFolderContent handle it?
        // loadFolderContent doesn't return nodes directly. 
        // We can check store.
        const updatedWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
        const rootChildren = updatedWs.childrenByParentId[filesParentKey(null)] || [];
        if (rootChildren.length === 1) {
             const rootId = rootChildren[0];
             const rootNode = updatedWs.nodesById[rootId];
             if (
               rootNode &&
               typeof rootNode.metadata === "object" &&
               rootNode.metadata !== null &&
               (rootNode.metadata as Record<string, unknown>).isSystem === true &&
               rootNode.type === "folder"
             ) {
                  toggleExpanded(projectId, rootNode.id, true);
             }
        }
        
        setIsBooting(false);
    } else {
        setIsBooting(false);
    }
  }, [projectId, loadFolderContent, toggleExpanded]);

  useEffect(() => {
    void boot();
  }, [boot]);

  // Auto-refresh when sync finishes (GitHub import)
  const prevSyncStatus = useRef(syncStatus);
  useEffect(() => {
    if (prevSyncStatus.current !== 'ready' && syncStatus === 'ready') {
        console.log("Sync finished, refreshing file explorer...");
        void loadFolderContent(null, 'refresh');
    }
    prevSyncStatus.current = syncStatus;
  }, [syncStatus, loadFolderContent]);


  // 2. Batch Hydration (Session Restore - O(1) Request)
  // Run once on mount if there are expanded folders.
  useEffect(() => {
    if (batchLoadedRef.current) return;
    const currentExpanded = useFilesWorkspaceStore.getState().byProjectId[projectId]?.expandedFolderIds || {};
    const foldersToLoad = Object.keys(currentExpanded).filter(id => !!currentExpanded[id]);
    
    if (foldersToLoad.length === 0) {
        batchLoadedRef.current = true;
        return;
    }

    batchLoadedRef.current = true;
    
    // Fire & Forget - no loading state blocking the UI
    void (async () => {
        try {
            // We pass "root" as explicit null logic if needed, but expandedFolderIds usually has UUIDs.
            const parents = foldersToLoad.map(id => id === "root" ? null : id);
            
            // Optimized Batch Fetch
            const allNodes = await getProjectBatchNodes(projectId, parents) as ProjectNode[];
            
            // We need to group them clientside since batch endpoint returns flat list
            const grouped: Record<string, ProjectNode[]> = {};
            // Initialize empty groups for requested parents
            parents.forEach(p => grouped[filesParentKey(p)] = []);
            
            allNodes.forEach(node => {
                const key = filesParentKey(node.parentId);
                if (grouped[key]) grouped[key].push(node);
            });
            
            // Update Store
            upsertNodes(projectId, allNodes);
            
            Object.entries(grouped).forEach(([key, children]) => {
                const pid = key === "__root__" ? null : key;
                setChildren(projectId, pid, children.map(n => n.id));
                markChildrenLoaded(projectId, pid);
                setFolderMeta(projectId, pid, { nextCursor: null, hasMore: false }); 
            });
            
        } catch (e) {
            console.error("Batch hydration failed", e);
        }
    })();
  }, [projectId, upsertNodes, setChildren, markChildrenLoaded, setFolderMeta]);


  // 3. User Interaction Expansion (Lazy Load - O(1))
  const handleToggleFolder = useCallback(async (node: ProjectNode) => {
    if (node.type !== "folder") return;
    const next = !expandedFolderIds[node.id];
    toggleExpanded(projectId, node.id, next);
    
    if (next) {
      const key = filesParentKey(node.id);
      const loaded = loadedChildren[key];
      if (!loaded) {
        await loadFolderContent(node.id, "refresh");
      }
    }
  }, [expandedFolderIds, toggleExpanded, projectId, loadedChildren, loadFolderContent]);

  // Helper for load more button
  const handleLoadMore = useCallback((folderId: string | null) => {
      void loadFolderContent(folderId, 'append');
  }, [loadFolderContent]);

  // --- End Data Fetching ---

  const includeFileByMode = useCallback(
    (node: ProjectNode) => {
      if (node.type !== "file") return true;
      if (viewMode === "all") return true;
      if (viewMode === "assets") return isAssetLike(node);
      // code
      return isTextLike(node) || !isAssetLike(node);
    },
    [viewMode]
  );

  // Pure tree calculation - decoupled from fast-changing state like selection
  const visibleRows = useMemo(() => {
    return buildVisibleRows({
      nodesById,
      childrenByParentId,
      loadedChildren,
      expandedFolderIds,
      folderMeta, // Pass meta
      sort,
      foldersFirst,
      includeNode: (n) => (n.type === "folder" ? true : includeFileByMode(n)),
    });
  }, [
    // structural dependencies (slow changing)
    nodesById,
    childrenByParentId,
    loadedChildren,
    expandedFolderIds,
    folderMeta,
    sort,
    foldersFirst,
    includeFileByMode, // depends on viewMode
  ]);

  const selectedNode = selectedNodeId ? nodesById[selectedNodeId] : null;

  const loadNodeInsights = useCallback(
    async (nodeId: string) => {
      setInsightsLoading(true);
      setInsightsError(null);
      try {
        const [tasksData, activityData] = await Promise.all([
          getNodeLinkedTasks(projectId, nodeId, 30),
          getNodeActivity(projectId, nodeId, 30),
        ]);
        setLinkedTasks(tasksData);
        setNodeActivity(activityData);
      } catch (error: unknown) {
        setLinkedTasks([]);
        setNodeActivity([]);
        setInsightsError(getErrorMessage(error, "Failed to load node insights"));
      } finally {
        setInsightsLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    if (!isInsightsOpen || !selectedNodeId) {
      if (!selectedNodeId) {
        setLinkedTasks([]);
        setNodeActivity([]);
        setInsightsError(null);
      }
      return;
    }
    void loadNodeInsights(selectedNodeId);
  }, [selectedNodeId, isInsightsOpen, loadNodeInsights]);

  const handleTaskLinksClick = useCallback(
    (node: ProjectNode) => {
      setSelectedNode(projectId, node.id, node.type === "folder" ? node.id : node.parentId ?? null);
      setSelectedNodeIds(projectId, [node.id]);
      setIsInsightsOpen(true);
      void loadNodeInsights(node.id);
    },
    [loadNodeInsights, projectId, setSelectedNode, setSelectedNodeIds]
  );



  const openCreate = useCallback((kind: "file" | "folder") => {
    if (!canEdit) return;
    const parentId =
      selectedNode?.type === "folder"
        ? selectedNode.id
        : selectedNode?.parentId ?? selectedFolderId ?? null;
    setCreateDialog({ open: true, kind, parentId, name: "" });
  }, [canEdit, selectedNode, selectedFolderId]);

  const openCreateInFolder = useCallback(
    (folderId: string | null, kind: "file" | "folder") => {
      if (!canEdit) return;
      if (folderId) {
        setSelectedNode(projectId, folderId, folderId);
        setSelectedNodeIds(projectId, [folderId]);
      }
      setCreateDialog({ open: true, kind, parentId: folderId, name: "" });
    },
    [canEdit, projectId, setSelectedNode, setSelectedNodeIds]
  );

  const confirmCreate = async () => {
    if (!createDialog.open) return;
    const name = createDialog.name.trim();
    if (!name) return;
    if (!canEdit) return;

    const parentId = createDialog.parentId ?? null;
    const mutationKey = `create:${projectId}:${createDialog.kind}:${parentId ?? "root"}:${name.toLowerCase()}`;

    try {
      const createdNode = await runUniqueMutation(mutationKey, async () => {
        if (!loadedChildren[filesParentKey(parentId)]) {
          await loadFolderContent(parentId, "refresh");
        }
        const siblingIds = childrenByParentId[filesParentKey(parentId)] || [];
        const siblings = siblingIds.map((id) => nodesById[id]).filter(Boolean);
        const dup = siblings.some((s) => s.name.toLowerCase() === name.toLowerCase());
        if (dup) {
          throw new Error("A file/folder with that name already exists here.");
        }

        if (createDialog.kind === "folder") {
          return (await createFolder(projectId, parentId, name)) as ProjectNode;
        }

        const fileExt = name.includes(".") ? name.split(".").pop() : "txt";
        const storagePath = `projects/${projectId}/${Math.random().toString(36).substring(2)}.${fileExt}`;
        const supabase = getSupabase();
        const emptyBlob = new Blob([""], { type: "text/plain" });
        const { error: uploadError } = await supabase.storage
          .from("project-files")
          .upload(storagePath, emptyBlob);
        if (uploadError) throw uploadError;

        return (await createFileNode(projectId, parentId, {
          name,
          s3Key: storagePath,
          size: 0,
          mimeType: "text/plain",
        })) as ProjectNode;
      });

      if (!createdNode) return;
      upsertNodes(projectId, [createdNode]);
      const parentKey = filesParentKey(parentId);
      const currentChildren = childrenByParentId[parentKey] || [];
      if (!currentChildren.includes(createdNode.id)) {
        setChildren(projectId, parentId, [...currentChildren, createdNode.id]);
      }

      if (parentId) toggleExpanded(projectId, parentId, true);
      showToast("Created", "success");
      recordOperation({
        label: `Created ${createDialog.kind} ${createdNode.name}`,
        status: "success",
        undo: canEdit
          ? {
              label: "Undo",
              run: async () => {
                await bulkTrashNodes([createdNode.id], projectId);
                useFilesWorkspaceStore.getState().removeNodeFromCaches(projectId, createdNode.id);
                await loadFolderContent(parentId, "refresh");
              },
            }
          : undefined,
      });
      setCreateDialog({ open: false });
    } catch (e: unknown) {
      showToast(`Create failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      recordOperation({
        label: `Create failed (${createDialog.kind})`,
        status: "error",
      });
    }
  };

  const openUpload = useCallback((parentId: string | null) => {
    if (!canEdit) return;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
        const files = Array.from(input.files || []);
        if (files.length === 0) return;

        const mutationKey = `upload:${projectId}:${parentId ?? "root"}:${files.map((f) => f.name).sort().join(",")}`;
        try {
          const result = await runUniqueMutation(mutationKey, async () => {
            const supabase = getSupabase();
            const createdNodes: ProjectNode[] = [];
            let failed = 0;

            for (const file of files) {
              try {
                const ext = file.name.split(".").pop() || "bin";
                const fileName = `${Math.random().toString(36).slice(2)}.${ext}`;
                const filePath = `projects/${projectId}/${fileName}`;
                const { error } = await supabase.storage.from("project-files").upload(filePath, file);
                if (error) throw error;

                const node = (await createFileNode(projectId, parentId, {
                  name: file.name,
                  s3Key: filePath,
                  size: file.size,
                  mimeType: file.type,
                })) as ProjectNode;
                createdNodes.push(node);
              } catch {
                failed += 1;
              }
            }

            if (createdNodes.length > 0) {
              upsertNodes(projectId, createdNodes);
              const parentKey = filesParentKey(parentId);
              const currentChildren = childrenByParentId[parentKey] || [];
              const nextChildren = [...currentChildren];
              for (const node of createdNodes) {
                if (!nextChildren.includes(node.id)) nextChildren.push(node.id);
              }
              setChildren(projectId, parentId, nextChildren);

              if (parentId) toggleExpanded(projectId, parentId, true);
              await loadFolderContent(parentId, "refresh");
            }

            return { createdNodes, failed };
          });

          if (!result) return;
          const { createdNodes, failed } = result;
          if (createdNodes.length > 0) {
            onOpenFile(createdNodes[0]);
            const msg =
              failed > 0
                ? `Uploaded ${createdNodes.length} file(s), ${failed} failed`
                : `Uploaded ${createdNodes.length} file(s)`;
            showToast(msg, failed > 0 ? "info" : "success");
            recordOperation({
              label: msg,
              status: failed > 0 ? "error" : "success",
            });
          } else {
            showToast("Upload failed", "error");
            recordOperation({ label: "Upload failed", status: "error" });
          }
        } catch (e: unknown) {
          showToast(`Upload failed: ${getErrorMessage(e, "Unknown error")}`, "error");
          recordOperation({ label: "Upload failed", status: "error" });
        }
    };
    input.click();
  }, [canEdit, projectId, runUniqueMutation, getSupabase, upsertNodes, childrenByParentId, setChildren, toggleExpanded, loadFolderContent, onOpenFile, showToast, recordOperation]);

  const openRename = useCallback((node: ProjectNode) => {
    if (!canEdit) return;
    setRenameState({ nodeId: node.id, value: node.name, original: node.name });
  }, [canEdit]);

  const confirmRename = useCallback(async () => {
    if (!renameState.nodeId) return;
    if (!canEdit) return;
    const node = nodesById[renameState.nodeId];
    if (!node) {
      setRenameState({ nodeId: null, value: "", original: "" });
      return;
    }

    const nextName = renameState.value.trim();
    if (!nextName) {
      showToast("Name is required", "error");
      return;
    }
    if (nextName === renameState.original) {
      setRenameState({ nodeId: null, value: "", original: "" });
      return;
    }

    const siblingIds = childrenByParentId[filesParentKey(node.parentId ?? null)] || [];
    const duplicateSibling = siblingIds
      .map((id) => nodesById[id])
      .filter(Boolean)
      .some((s) => s.id !== node.id && s.name.toLowerCase() === nextName.toLowerCase());
    if (duplicateSibling) {
      showToast("A file/folder with that name already exists here.", "error");
      return;
    }

    const mutationKey = `rename:${projectId}:${node.id}:${nextName.toLowerCase()}`;
    try {
      const updated = await runUniqueMutation(mutationKey, async () => {
        return (await renameNode(node.id, nextName, projectId)) as ProjectNode;
      });
      if (!updated) return;
      upsertNodes(projectId, [updated]);
      setRenameState({ nodeId: null, value: "", original: "" });
      showToast("Renamed", "success");
      recordOperation({
        label: `Renamed ${renameState.original} -> ${nextName}`,
        status: "success",
        undo: {
          label: "Undo",
          run: async () => {
            const reverted = (await renameNode(node.id, renameState.original, projectId)) as ProjectNode;
            upsertNodes(projectId, [reverted]);
          },
        },
      });
    } catch (e: unknown) {
      showToast(`Rename failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      recordOperation({
        label: `Rename failed (${renameState.original})`,
        status: "error",
      });
    }
  }, [
    renameState.nodeId,
    renameState.value,
    renameState.original,
    canEdit,
    nodesById,
    childrenByParentId,
    projectId,
    upsertNodes,
    showToast,
    runUniqueMutation,
    recordOperation,
  ]);

  const resolveActionNodes = useCallback(
    (node: ProjectNode) => {
      const currentSelected = useFilesWorkspaceStore.getState().byProjectId[projectId]?.selectedNodeIds || [];
      if (currentSelected.length > 1 && currentSelected.includes(node.id)) {
        return currentSelected.map((id) => nodesById[id]).filter(Boolean) as ProjectNode[];
      }
      return [node];
    },
    [projectId, nodesById]
  );



  const openDelete = useCallback((nodeOrNodes: ProjectNode | ProjectNode[]) => {
    if (!canEdit) return;
    const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
    setDeleteDialog({ open: true, nodes });
  }, [canEdit]);

  const openMove = useCallback((nodeOrNodes: ProjectNode | ProjectNode[]) => {
    if (!canEdit) return;
    const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
    setMoveDialog({ open: true, nodes, targetFolderId: null });
  }, [canEdit]);

  const confirmMove = async () => {
    const nodes = moveDialog.nodes;
    if (!nodes.length) return;
    if (!canEdit) return;

    const target = moveDialog.targetFolderId; // null means root
    
    // Validation
    for (const node of nodes) {
        if (target === node.id) {
            showToast(`Can't move ${node.name} into itself.`, "error");
            return;
        }
        // Prevent moving a folder into its own descendant
        if (node.type === "folder" && target) {
            let cur: string | null = target;
            for (let i = 0; i < 50; i++) {
                if (!cur) break;
                if (cur === node.id) {
                    showToast(`Can't move ${node.name} into its own descendant.`, "error");
                    return;
                }
                cur = nodesById[cur]?.parentId ?? null;
            }
        }
    }

    const nodeIds = nodes.map((n) => n.id).sort();
    const originalParentByNode = new Map<string, string | null>(
      nodes.map((node) => [node.id, node.parentId ?? null])
    );
    const mutationKey = `move:${projectId}:${target ?? "root"}:${nodeIds.join(",")}`;

    try {
      const result = await runUniqueMutation(mutationKey, async () => {
        const staleParents = new Set<string | null>();
        for (const node of nodes) {
          const oldParentId = node.parentId ?? null;
          if (oldParentId !== target) staleParents.add(oldParentId);
        }

        const updatedNodes = (await bulkMoveNodes(nodeIds, target, projectId)) as ProjectNode[];
        if (updatedNodes.length > 0) {
          upsertNodes(projectId, updatedNodes);
        }

        await Promise.all(Array.from(staleParents).map((pid) => loadFolderContent(pid, "refresh")));
        await loadFolderContent(target ?? null, "refresh");
        if (target) toggleExpanded(projectId, target, true);
        return updatedNodes;
      });

      if (result === null) return;
      const movedCount = result.length;
      showToast(`Moved ${movedCount} item${movedCount === 1 ? "" : "s"}`, "success");
      recordOperation({
        label: `Moved ${movedCount} item${movedCount === 1 ? "" : "s"}`,
        status: "success",
        undo: movedCount
          ? {
              label: "Undo",
              run: async () => {
                const groupedByParent: Record<string, string[]> = {};
                for (const [id, parentId] of originalParentByNode.entries()) {
                  const key = parentId ?? "__root__";
                  if (!groupedByParent[key]) groupedByParent[key] = [];
                  groupedByParent[key].push(id);
                }
                for (const [parentKey, ids] of Object.entries(groupedByParent)) {
                  const parentId = parentKey === "__root__" ? null : parentKey;
                  if (ids.length > 0) {
                    await bulkMoveNodes(ids, parentId, projectId);
                    await loadFolderContent(parentId, "refresh");
                  }
                }
                if (target !== null) {
                  await loadFolderContent(target, "refresh");
                } else {
                  await loadFolderContent(null, "refresh");
                }
              },
            }
          : undefined,
      });
      setMoveDialog({ open: false, nodes: [], targetFolderId: null });
    } catch (e: unknown) {
      showToast(`Move failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      recordOperation({
        label: "Move failed",
        status: "error",
      });
    }
  };

  const confirmDelete = async () => {
    const nodes = deleteDialog.nodes;
    if (!nodes.length) return;
    if (!canEdit) return;

    const nodeIds = nodes.map((n) => n.id).sort();
    const mutationKey = `trash:${projectId}:${nodeIds.join(",")}`;

    try {
      const result = await runUniqueMutation(mutationKey, async () => {
        const staleParents = new Set<string | null>();
        for (const node of nodes) staleParents.add(node.parentId ?? null);

        const response = await bulkTrashNodes(nodeIds, projectId);
        const trashedIds: string[] = response.trashedIds || [];

        for (const nodeId of trashedIds) {
          useFilesWorkspaceStore.getState().removeNodeFromCaches(projectId, nodeId);
          onNodeDeleted?.(nodeId);
        }

        await Promise.all(Array.from(staleParents).map((pid) => loadFolderContent(pid, "refresh")));
        return trashedIds.length;
      });

      if (result === null) return;
      showToast(`Moved ${result} item${result === 1 ? "" : "s"} to Trash`, "success");
      recordOperation({
        label: `Moved ${result} item${result === 1 ? "" : "s"} to trash`,
        status: "success",
        undo: result
          ? {
              label: "Undo",
              run: async () => {
                await bulkRestoreNodes(nodeIds, projectId);
                const staleParents = new Set<string | null>();
                for (const node of nodes) staleParents.add(node.parentId ?? null);
                await Promise.all(Array.from(staleParents).map((pid) => loadFolderContent(pid, "refresh")));
              },
            }
          : undefined,
      });
      setDeleteDialog({ open: false, nodes: [] });
    } catch (e: unknown) {
      showToast(`Delete failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      recordOperation({
        label: "Move to trash failed",
        status: "error",
      });
    }
  };




  // Search mode: server-backed (ilike) + client filtering for responsiveness.
  const [searchResults, setSearchResults] = useState<ProjectNode[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [trashNodesState, setTrashNodesState] = useState<ProjectNode[]>([]);
  const [isTrashLoading, setIsTrashLoading] = useState(false);

  useEffect(() => {
    if (searchQuery.trim()) {
      setInlineSearchOpen(true);
    }
  }, [searchQuery]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setIsSearching(false);
      searchSnippetsRef.current = {};
      searchRequestIdRef.current += 1;
      return;
    }
    if (q.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      searchSnippetsRef.current = {};
      searchRequestIdRef.current += 1;
      return;
    }

    const requestId = ++searchRequestIdRef.current;
    const t = setTimeout(async () => {
      setIsSearching(true);
      try {
        const federated = await searchProjectNodesFederated(projectId, q, 80);
        if (requestId !== searchRequestIdRef.current) return;
        const orderedIds = federated.map((item) => item.nodeId);
        searchSnippetsRef.current = Object.fromEntries(
          federated.map((item) => [item.nodeId, item.snippet])
        );
        if (orderedIds.length === 0) {
          setSearchResults([]);
          return;
        }

        const latestNodesByIdBeforeHydrate =
          useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById || {};
        const missing = orderedIds.filter((id) => !latestNodesByIdBeforeHydrate[id]);
        if (missing.length > 0) {
          const hydrated = (await getNodesByIds(projectId, missing)) as ProjectNode[];
          if (requestId !== searchRequestIdRef.current) return;
          if (hydrated.length > 0) upsertNodes(projectId, hydrated);
        }

        const latestNodesById =
          useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById || {};
        const orderedNodes = orderedIds
          .map((id) => latestNodesById[id])
          .filter((node): node is ProjectNode => !!node);
        setSearchResults(orderedNodes);

        const fileIds = orderedNodes.filter((n) => n.type === "file").map((n) => n.id);
        if (fileIds.length) {
          const counts = await getTaskLinkCounts(projectId, fileIds);
          if (requestId !== searchRequestIdRef.current) return;
          setTaskLinkCounts(projectId, counts);
        }
      } finally {
        if (requestId === searchRequestIdRef.current) {
          setIsSearching(false);
        }
      }
    }, 200);

    return () => clearTimeout(t);
  }, [projectId, upsertNodes, searchQuery, setTaskLinkCounts]);

  // Trash listing
  useEffect(() => {
    if (explorerMode !== "trash") return;
    setIsTrashLoading(true);
    void (async () => {
      try {
        const nodes = (await getTrashNodes(projectId, searchQuery.trim() || undefined)) as ProjectNode[];
        upsertNodes(projectId, nodes);
        setTrashNodesState(nodes);
      } finally {
        setIsTrashLoading(false);
      }
    })();
  }, [projectId, upsertNodes, explorerMode, searchQuery]);

  // Quick open results
  useEffect(() => {
    if (!quickOpen.open) return;
    const q = quickOpen.query.trim();

    if (!q) {
      const recentNodes = recents
        .map((id) => nodesById[id])
        .filter((n): n is ProjectNode => !!n && n.type === "file")
        .slice(0, 20);
      setQuickOpenResults(recentNodes);
      return;
    }
    if (q.length < 2) {
      setQuickOpenResults([]);
      setQuickOpenLoading(false);
      quickOpenRequestIdRef.current += 1;
      return;
    }

    const requestId = ++quickOpenRequestIdRef.current;
    const t = setTimeout(async () => {
      setQuickOpenLoading(true);
      try {
        const nodes = (await getProjectNodes(projectId, null, q)) as ProjectNode[];
        if (requestId !== quickOpenRequestIdRef.current) return;
        const files = nodes.filter((n) => n.type === "file").slice(0, 50);
        upsertNodes(projectId, files);
        setQuickOpenResults(files);
      } finally {
        if (requestId === quickOpenRequestIdRef.current) {
          setQuickOpenLoading(false);
        }
      }
    }, 150);

    return () => clearTimeout(t);
  }, [projectId, quickOpen.open, quickOpen.query, upsertNodes, nodesById, recents]);

  const effectiveMode = searchQuery.trim() ? "search" : explorerMode;

  const rowsToRender = useMemo(() => {
    if (effectiveMode === "search") {
      return searchResults
        .filter((n) => n.type === "folder" || includeFileByMode(n))
        .map(
          (n) =>
            ({ kind: "node", nodeId: n.id, level: 0, parentId: n.parentId ?? null, indentationGuides: [] } as VisibleRow)
        );
    }
    if (effectiveMode === "favorites") {
      const ids = Object.keys(favorites).filter((id) => favorites[id]);
      const nodes = ids.map((id) => nodesById[id]).filter(Boolean);
      return nodes
        .filter((n) => n.type === "folder" || includeFileByMode(n))
        .map(
          (n) => ({ kind: "node", nodeId: n.id, level: 0, parentId: n.parentId ?? null, indentationGuides: [] } as VisibleRow)
        );
    }
    if (effectiveMode === "recents") {
      const nodes = recents.map((id) => nodesById[id]).filter(Boolean);
      return nodes
        .filter((n) => n.type === "folder" || includeFileByMode(n))
        .map(
          (n) => ({ kind: "node", nodeId: n.id, level: 0, parentId: n.parentId ?? null, indentationGuides: [] } as VisibleRow)
        );
    }
    if (effectiveMode === "trash") {
      return trashNodesState
        .filter((n) => n.type === "folder" || includeFileByMode(n))
        .map(
          (n) => ({ kind: "node", nodeId: n.id, level: 0, parentId: n.parentId ?? null, indentationGuides: [] } as VisibleRow)
        );
    }
    return visibleRows;
  }, [effectiveMode, includeFileByMode, searchResults, trashNodesState, visibleRows, favorites, nodesById, recents]);

  const handleSelect = useCallback((node: ProjectNode, e?: React.MouseEvent) => {
    if (mode === "select") {
      const currentSelected =
        useFilesWorkspaceStore.getState().byProjectId[projectId]?.selectedNodeIds || controlledSelectedNodeIds;
      const exists = currentSelected.includes(node.id);
      const newSelection = exists
        ? currentSelected.filter((id) => id !== node.id)
        : [...currentSelected, node.id];
      const normalizedSelection = Array.from(new Set(newSelection));
      setSelectedNodeIds(projectId, normalizedSelection);
      onSelectionChange?.(normalizedSelection);
      return;
    }

    // Multi-Select Logic
    if (e && (e.metaKey || e.ctrlKey)) {
        // Toggle selection
        // Use getState for latest selection without re-rendering usage dependency
        const currentSelected = useFilesWorkspaceStore.getState().byProjectId[projectId]?.selectedNodeIds || [];
        
        const alreadySelected = currentSelected.includes(node.id);
        let newSelection: string[];
        if (alreadySelected) {
            newSelection = currentSelected.filter(id => id !== node.id);
        } else {
            newSelection = [...currentSelected, node.id];
        }
        setSelectedNodeIds(projectId, newSelection);
        
        if (!alreadySelected) {
            setSelectedNode(projectId, node.id, node.type === "folder" ? node.id : node.parentId ?? null);
        }
        return;
    }

    if (e && e.shiftKey && selectedNodeId) {
        // Range selection
        if (rowsToRender.length === 0) return;
        
        const anchorId = selectedNodeId;
        const targetId = node.id;
        
        const anchorIndex = rowsToRender.findIndex(r => r.kind === "node" && r.nodeId === anchorId);
        const targetIndex = rowsToRender.findIndex(r => r.kind === "node" && r.nodeId === targetId);
        
        if (anchorIndex !== -1 && targetIndex !== -1) {
            const start = Math.min(anchorIndex, targetIndex);
            const end = Math.max(anchorIndex, targetIndex);
            
            const rangeIds: string[] = [];
            for (let i = start; i <= end; i++) {
                const row = rowsToRender[i];
                if (row.kind === "node") {
                    rangeIds.push(row.nodeId);
                }
            }
            setSelectedNodeIds(projectId, rangeIds);
            return;
        }
    }

    setSelectedNodeIds(projectId, [node.id]);
    setSelectedNode(projectId, node.id, node.type === "folder" ? node.id : node.parentId ?? null);
    if (node.type === "file") {
      addRecent(projectId, node.id);
      onOpenFile(node);
    }
  }, [projectId, rowsToRender, mode, selectedNodeId, setSelectedNode, setSelectedNodeIds, addRecent, onOpenFile, controlledSelectedNodeIds, onSelectionChange]);

  // Keyboard navigation: arrows operate on the currently rendered list.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowIndexById = useMemo(() => {
    const map = new Map<string, number>();
    rowsToRender.forEach((r, idx) => {
      if (r.kind === "node") map.set(r.nodeId, idx);
    });
    return map;
  }, [rowsToRender]);

  const selectedIndex = selectedNodeId ? rowIndexById.get(selectedNodeId) : undefined;

  const getNodePath = useCallback((node: ProjectNode | null | undefined) => {
    if (!node) return "";
    const parts: string[] = [node.name];
    let cursor = node.parentId;
    let guard = 0;
    while (cursor && guard < 256) {
      const parent = nodesById[cursor];
      if (!parent) break;
      parts.unshift(parent.name);
      cursor = parent.parentId;
      guard += 1;
    }
    return parts.join("/");
  }, [nodesById]);

  const focusRow = (index: number) => {
    const row = rowsToRender[index];
    if (row?.kind === "node") {
      const node = nodesById[row.nodeId];
      if (node) handleSelect(node);
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return;
    }

    if (renameState.nodeId) return;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
      e.preventDefault();
      setQuickOpen({ open: true, query: "" });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setCommandPalette({ open: true, query: "" });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === "n") {
      if (!canEdit) return;
      e.preventDefault();
      openCreate("file");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === "f") {
      if (!canEdit) return;
      e.preventDefault();
      openCreate("folder");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "m") {
      if (!canEdit) return;
      e.preventDefault();
      if (storeSelectedNodeIds.length > 0) {
        const nodes = storeSelectedNodeIds.map(id => nodesById[id]).filter(Boolean);
        openMove(nodes);
      } else if (selectedNode) {
        openMove(selectedNode);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = selectedIndex === undefined ? 0 : Math.min(rowsToRender.length - 1, selectedIndex + 1);
      focusRow(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = selectedIndex === undefined ? 0 : Math.max(0, selectedIndex - 1);
      focusRow(prev);
    } else    if (e.key === "ArrowRight") {
      if (!selectedNode) return;
      if (selectedNode.type === "folder") {
        e.preventDefault();
        if (!expandedFolderIds[selectedNode.id]) await handleToggleFolder(selectedNode);
      }
    } else if (e.key === "ArrowLeft") {
      if (!selectedNode) return;
      if (selectedNode.type === "folder" && expandedFolderIds[selectedNode.id]) {
        e.preventDefault();
        toggleExpanded(projectId, selectedNode.id, false);
      } else if (selectedNode.parentId) {
        const parent = nodesById[selectedNode.parentId];
        if (parent) {
          e.preventDefault();
          handleSelect(parent);
        }
      }
    } else if (e.key === "Enter") {
      if (!selectedNode) return;
      e.preventDefault();
      if (selectedNode.type === "folder") await handleToggleFolder(selectedNode);
      else handleSelect(selectedNode);
    } else if (e.key === " ") {
      if (!selectedNode || selectedNode.type !== "folder") return;
      e.preventDefault();
      await handleToggleFolder(selectedNode);
    } else if (e.key === "F2") {
      if (!selectedNode) return;
      e.preventDefault();
      openRename(selectedNode);
    } else if (e.key === "Escape") {
      if (renameState.nodeId) {
        e.preventDefault();
        setRenameState({ nodeId: null, value: "", original: "" });
      }
    } else if (e.key === "Delete") {
      if (!canEdit) return;
      e.preventDefault();
      
      // Use selection if available, else focused node
      if (storeSelectedNodeIds.length > 0) {
        const nodes = storeSelectedNodeIds.map(id => nodesById[id]).filter(Boolean);
        openDelete(nodes);
      } else if (selectedNode) {
        openDelete(selectedNode);
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      if (!selectedNode) return;
      e.preventDefault();
      const path = getNodePath(selectedNode);
      if (!path) return;
      try {
        await navigator.clipboard.writeText(path);
        showToast("Path copied", "success");
      } catch {
        showToast("Failed to copy path", "error");
      }
    }
  };

  const handleDropOnFolder = useCallback(async (folderId: string, draggedId: string) => {
    if (!canEdit) return;
    if (folderId === draggedId) return;

    // Determine items to move
    let nodesToMove: string[] = [draggedId];
    if (storeSelectedNodeIds.includes(draggedId)) {
        // If the dragged item is part of the selection, move the whole selection
        nodesToMove = [...storeSelectedNodeIds];
    }
    
    // Filter out if trying to move folder into itself (simple check)
    nodesToMove = nodesToMove.filter(id => id !== folderId);
    if (nodesToMove.length === 0) return;

    const sortedIds = [...nodesToMove].sort();
    const mutationKey = `drop-move:${projectId}:${folderId}:${sortedIds.join(",")}`;

    try {
      const result = await runUniqueMutation(mutationKey, async () => {
        const staleParents = new Set<string | null>();
        for (const id of nodesToMove) {
          const oldParentId = nodesById[id]?.parentId ?? null;
          if (oldParentId !== folderId) staleParents.add(oldParentId);
        }

        const updatedNodes = (await bulkMoveNodes(sortedIds, folderId, projectId)) as ProjectNode[];
        if (updatedNodes.length > 0) upsertNodes(projectId, updatedNodes);

        if (updatedNodes.length > 0) {
          await Promise.all(Array.from(staleParents).map((pid) => loadFolderContent(pid, "refresh")));
          await loadFolderContent(folderId, "refresh");
          toggleExpanded(projectId, folderId, true);
        }
        return updatedNodes.length;
      });

      if (result === null || result === 0) return;
      showToast(`Moved ${result} item${result === 1 ? "" : "s"}`, "success");
      recordOperation({
        label: `Dragged ${result} item${result === 1 ? "" : "s"} to folder`,
        status: "success",
      });
    } catch (e: unknown) {
      showToast(`Move failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      recordOperation({
        label: "Drag move failed",
        status: "error",
      });
    }
  }, [canEdit, storeSelectedNodeIds, nodesById, projectId, runUniqueMutation, upsertNodes, loadFolderContent, toggleExpanded, showToast, recordOperation]);

  const handleOpenNodeFromMenu = useCallback(
    (node: ProjectNode) => {
      handleSelect(node);
      if (node.type === "folder" && !expandedFolderIds[node.id]) {
        void handleToggleFolder(node);
      }
    },
    [expandedFolderIds, handleSelect, handleToggleFolder]
  );

  const handleMoveFromMenu = useCallback(
    (node: ProjectNode) => {
      openMove(resolveActionNodes(node));
    },
    [openMove, resolveActionNodes]
  );

  const handleDeleteFromMenu = useCallback(
    (node: ProjectNode) => {
      openDelete(resolveActionNodes(node));
    },
    [openDelete, resolveActionNodes]
  );

  const handleUploadToFolder = useCallback(
    (folderId: string | null) => {
      if (!canEdit) return;
      openUpload(folderId);
    },
    [canEdit, openUpload]
  );








  // Stable Context for FileTreeItem
  const contextValue = useMemo(() => ({
    // State
    nodesById,
    selectedNodeId,
    selectedNodeIds: effectiveSelectedNodeIds,
    expandedFolderIds,
    favorites,
    taskLinkCounts,
    mode: mode || "default", // ensure string
    canEdit,
    projectName: projectName || "Project",
    isTrashMode: effectiveMode === "trash",
    
    // Actions
    onToggle: (node: ProjectNode) => void handleToggleFolder(node),
    onSelect: (node: ProjectNode, e?: React.MouseEvent) => handleSelect(node, e),
    onDragStart: () => {},
    onDragEnd: () => {},
    onDrop: (targetId: string, draggedId: string) => void handleDropOnFolder(targetId, draggedId),
    onLoadMore: (pid: string | null) => handleLoadMore(pid),
    openCreate: (kind: "file" | "folder") => openCreate(kind),
    createInFolder: (folderId: string | null, kind: "file" | "folder") =>
      openCreateInFolder(folderId, kind),
    uploadToFolder: (folderId: string | null) => handleUploadToFolder(folderId),
    openNode: (node: ProjectNode) => handleOpenNodeFromMenu(node),
    renameNode: (node: ProjectNode) => openRename(node),
    moveNode: (node: ProjectNode) => handleMoveFromMenu(node),
    deleteNode: (node: ProjectNode) => handleDeleteFromMenu(node),
    toggleFavorite: (nodeId: string) => toggleFavorite(projectId, nodeId),
    onTaskLinksClick: (node: ProjectNode) => handleTaskLinksClick(node),
    restoreNode: async (id: string) => {
        const mutationKey = `restore:${projectId}:${id}`;
        const result = await runUniqueMutation(mutationKey, async () => {
          await bulkRestoreNodes([id], projectId);
          const nodes = (await getTrashNodes(projectId)) as ProjectNode[];
          setTrashNodesState(nodes);
          const node = nodesById[id];
          if (node?.parentId) await loadFolderContent(node.parentId, "refresh");
          return true;
        });
        if (result === null) return;
        showToast("Restored", "success");
        recordOperation({
          label: "Restored item",
          status: "success",
          undo: {
            label: "Undo",
            run: async () => {
              await bulkTrashNodes([id], projectId);
              const nodes = (await getTrashNodes(projectId)) as ProjectNode[];
              setTrashNodesState(nodes);
            },
          },
        });
    }
  }), [
    nodesById,
    selectedNodeId,
    effectiveSelectedNodeIds,
    expandedFolderIds,
    favorites,
    taskLinkCounts,
    mode,
    canEdit,
    projectName,
    effectiveMode,
    projectId,
    handleSelect,
    handleToggleFolder,
    handleDropOnFolder,
    handleLoadMore,
    openCreate,
    openCreateInFolder,
    handleUploadToFolder,
    handleOpenNodeFromMenu,
    openRename,
    handleMoveFromMenu,
    handleDeleteFromMenu,
    handleTaskLinksClick,
    toggleFavorite,
    runUniqueMutation,
    recordOperation,
    showToast,
    loadFolderContent
  ]);

  const handleSaveCurrentView = useCallback(() => {
    const defaultName = `View ${new Date().toLocaleDateString()}`;
    const name = window.prompt("Save current view as:", defaultName);
    if (!name) return;
    saveCurrentView(projectId, name);
    const latestViews = useFilesWorkspaceStore.getState().byProjectId[projectId]?.savedViews || [];
    const saved = latestViews.find(
      (view) => view.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (saved) setSelectedSavedViewId(saved.id);
    showToast("View saved", "success");
  }, [projectId, saveCurrentView, showToast]);

  const handleApplySavedView = useCallback(
    (viewId: string) => {
      if (!viewId) return;
      applySavedView(projectId, viewId);
      setSelectedSavedViewId(viewId);
      showToast("View applied", "success");
    },
    [applySavedView, projectId, showToast]
  );

  const handleDeleteSavedView = useCallback(() => {
    if (!selectedSavedViewId) return;
    deleteSavedView(projectId, selectedSavedViewId);
    setSelectedSavedViewId("");
    showToast("View removed", "success");
  }, [deleteSavedView, projectId, selectedSavedViewId, showToast]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="h-full flex flex-col bg-white dark:bg-zinc-900 outline-none"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 p-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 min-w-0">
          <select
            className="h-7 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs font-medium px-2 focus:ring-2 focus:ring-indigo-500/20 outline-none cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            value={viewMode}
            onChange={(e) => setViewMode(projectId, e.target.value as FilesViewMode)}
            title="View mode"
          >
            <option value="code">Code</option>
            <option value="assets">Assets</option>
            <option value="all">All Files</option>
          </select>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                title="File actions"
              >
                Actions
                <MoreHorizontal className="w-3.5 h-3.5 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setOperationsOpen((open) => !open);
                }}
              >
                {operationsOpen ? "Hide operations center" : "Show operations center"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setIsInsightsOpen((open) => !open);
                }}
              >
                {isInsightsOpen ? "Hide insights" : "Show insights"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  handleSaveCurrentView();
                }}
              >
                Save current view
              </DropdownMenuItem>
              {savedViews.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  {savedViews.map((view) => (
                    <DropdownMenuItem
                      key={view.id}
                      onSelect={(e) => {
                        e.preventDefault();
                        handleApplySavedView(view.id);
                      }}
                    >
                      {selectedSavedViewId === view.id ? "✓ " : ""}
                      {view.name}
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
              <DropdownMenuItem
                disabled={!selectedSavedViewId}
                onSelect={(e) => {
                  e.preventDefault();
                  handleDeleteSavedView();
                }}
              >
                Delete saved view
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!canEdit}
                onSelect={(e) => {
                  e.preventDefault();
                  openCreate("folder");
                }}
              >
                New folder
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canEdit}
                onSelect={(e) => {
                  e.preventDefault();
                  openCreate("file");
                }}
              >
                New file
              </DropdownMenuItem>
              {uploadEnabled ? (
                <DropdownMenuItem
                  disabled={!canEdit}
                  onSelect={(e) => {
                    e.preventDefault();
                    if (!canEdit) return;
                    const parentId =
                      selectedNode?.type === "folder"
                        ? selectedNode.id
                        : selectedNode?.parentId ?? selectedFolderId ?? null;
                    openUpload(parentId);
                  }}
                >
                  Upload file
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Search & sort */}
      <div className="px-2 py-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 mr-auto">
            <Button
              type="button"
              size="sm"
              variant={explorerMode === "tree" ? "default" : "ghost"}
              className={cn("h-7 w-7 p-0", explorerMode === "tree" ? "" : "text-zinc-500")}
              onClick={() => setExplorerMode(projectId, "tree")}
              title="All files"
            >
              <List className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant={explorerMode === "favorites" ? "default" : "ghost"}
              className={cn("h-7 w-7 p-0", explorerMode === "favorites" ? "" : "text-zinc-500")}
              onClick={() => setExplorerMode(projectId, "favorites")}
              title="Favorites"
            >
              <Star className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant={explorerMode === "recents" ? "default" : "ghost"}
              className={cn("h-7 w-7 p-0", explorerMode === "recents" ? "" : "text-zinc-500")}
              onClick={() => setExplorerMode(projectId, "recents")}
              title="Recent files"
            >
              <Clock className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant={explorerMode === "trash" ? "default" : "ghost"}
              className={cn("h-7 w-7 p-0", explorerMode === "trash" ? "" : "text-zinc-500")}
              onClick={() => setExplorerMode(projectId, "trash")}
              disabled={!canEdit}
              title="Trash"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center gap-1">
            <div
              className={cn(
                "overflow-hidden transition-all duration-200 ease-out",
                inlineSearchOpen ? "w-[136px] opacity-100" : "w-0 opacity-0"
              )}
            >
              <Input
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(projectId, e.target.value)}
                className="h-7 bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-xs px-2"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant={inlineSearchOpen ? "secondary" : "ghost"}
              className="h-7 w-7 p-0"
              title="Search files"
              onClick={() => {
                setInlineSearchOpen((prev) => {
                  const next = !prev;
                  if (!next) setSearchQuery(projectId, "");
                  return next;
                });
              }}
            >
              <Search className="w-4 h-4" />
            </Button>
          </div>

          <select
            className="h-7 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs px-2 cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500/20"
            value={sort}
            onChange={(e) => setSort(projectId, e.target.value as "name" | "updated" | "type")}
          >
            <option value="name">Name</option>
            <option value="updated">Updated</option>
            <option value="type">Type</option>
          </select>

          {isSearching ? <span className="text-xs text-zinc-400">...</span> : null}
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {accessError ? (
          <div className="p-6 text-sm text-zinc-500">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">Files unavailable</div>
            <div className="mt-1">
              {accessError === "Forbidden"
                ? "You don’t have permission to view this project’s files."
                : accessError}
            </div>
          </div>
        ) : isBooting || (effectiveMode === "trash" && isTrashLoading) ? (
          <div className="p-6 text-sm text-zinc-500 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : viewMode === "assets" ? (
          <VirtuosoGrid
                style={{ height: "100%" }}
                totalCount={rowsToRender.length}
                components={{
                    List: AssetGridList,
                    Item: AssetGridItem,
                }}
                itemContent={(index) => {
                    const row = rowsToRender[index];
                    if (row.kind !== 'node') return null;
                    const node = nodesById[row.nodeId];
                    if (!node) return null;
                    
                    return (
                        <FileGridItem
                            node={node}
                            selected={effectiveSelectedNodeIds.includes(node.id) || selectedNodeId === node.id}
                            onSelect={(e) => handleSelect(node, e)}
                            onDoubleClick={() => {
                                if (node.type === 'folder') void handleToggleFolder(node);
                                else handleSelect(node);
                            }}
                        />
                    );
                }}
             />
          ) : (
          <Virtuoso
            data={rowsToRender}
            context={contextValue}
            itemContent={(_, row, context) => <div className="px-2"><FileTreeItem row={row} context={context} /></div>}
            style={{ height: "100%" }}
          />
          )
        }
      </div>

      {operationsOpen ? (
        <div className="flex-none border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
          <div className="px-3 py-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Operation Center</div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => setOperations([])}
              disabled={operations.length === 0}
            >
              Clear
            </Button>
          </div>
          <div className="max-h-28 overflow-auto px-2 pb-2 space-y-1">
            {operations.length === 0 ? (
              <div className="text-[11px] text-zinc-500 px-1 py-1">No recent operations.</div>
            ) : (
              operations.map((op) => (
                <div
                  key={op.id}
                  className="rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-[11px] flex items-center gap-2"
                >
                  {op.status === "success" ? (
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  ) : op.status === "error" ? (
                    <ShieldX className="w-3.5 h-3.5 text-red-500" />
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin" />
                  )}
                  <span className="truncate text-zinc-700 dark:text-zinc-300">{op.label}</span>
                  {op.undo ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 ml-auto text-[10px]"
                      onClick={() => void executeUndo(op.id)}
                    >
                      <Undo2 className="w-3 h-3 mr-1" />
                      {op.undo.label}
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {isInsightsOpen ? (
        <div className="flex-none border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
          <div className="px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Node Insights
            {selectedNode ? (
              <span className="ml-2 font-normal text-zinc-500 truncate">{selectedNode.name}</span>
            ) : null}
          </div>
          <div className="max-h-44 overflow-auto px-2 pb-2 space-y-2">
            {!selectedNode ? (
              <div className="text-[11px] text-zinc-500 px-1 py-1">
                Select a file or folder to inspect linked tasks and activity.
              </div>
            ) : insightsLoading ? (
              <div className="text-[11px] text-zinc-500 px-1 py-1 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading insights...
              </div>
            ) : insightsError ? (
              <div className="text-[11px] text-red-500 px-1 py-1">{insightsError}</div>
            ) : (
              <>
                <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2">
                  <div className="text-[11px] font-semibold mb-1 flex items-center gap-1">
                    <Link2 className="w-3 h-3" />
                    Linked Tasks ({linkedTasks.length})
                  </div>
                  {linkedTasks.length === 0 ? (
                    <div className="text-[11px] text-zinc-500">No task links for this node.</div>
                  ) : (
                    <div className="space-y-1">
                      {linkedTasks.slice(0, 6).map((task) => (
                        <div key={task.id} className="text-[11px] rounded-sm bg-zinc-100/70 dark:bg-zinc-800/70 px-1.5 py-1">
                          <div className="font-medium truncate">
                            {task.taskNumber ? `#${task.taskNumber} ` : ""}{task.title}
                          </div>
                          <div className="text-zinc-500 uppercase tracking-wide">
                            {task.status} • {task.priority}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2">
                  <div className="text-[11px] font-semibold mb-1">Recent Activity</div>
                  {nodeActivity.length === 0 ? (
                    <div className="text-[11px] text-zinc-500">No activity recorded yet.</div>
                  ) : (
                    <div className="space-y-1">
                      {nodeActivity.slice(0, 6).map((entry) => (
                        <div key={entry.id} className="text-[11px] rounded-sm bg-zinc-100/70 dark:bg-zinc-800/70 px-1.5 py-1">
                          <div className="font-medium truncate">{entry.type.replaceAll("_", " ")}</div>
                          <div className="text-zinc-500 truncate">
                            {entry.by || "system"} • {new Date(entry.at).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      
      
      {/* Source Control Section */}
      {effectiveMode === "tree" ? (
        <div className="flex-none border-t border-zinc-200 dark:border-zinc-800 flex flex-col transition-[height] duration-200" style={{ height: isSourceControlOpen ? "150px" : "auto" }}>
            <button 
                className="w-full flex items-center gap-1 px-2 py-1 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold text-zinc-600 dark:text-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-100"
                onClick={() => setIsSourceControlOpen(!isSourceControlOpen)}
            >
                {isSourceControlOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Source Control
            </button>
            {isSourceControlOpen && (
                <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 bg-white dark:bg-zinc-900">
                    <SourceControlPanel projectId={projectId} className="px-2" />
                </div>
            )}
        </div>
      ) : null}

      {/* Outline Section */}
      {effectiveMode === "tree" || effectiveMode === "search" ? (
        <div className="flex-none border-t border-zinc-200 dark:border-zinc-800 flex flex-col transition-[height] duration-200" style={{ height: isOutlineOpen ? "250px" : "auto" }}>
            <button 
                className="w-full flex items-center gap-1 px-2 py-1 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                onClick={() => setIsOutlineOpen(!isOutlineOpen)}
            >
                {isOutlineOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Outline
            </button>
            {isOutlineOpen && (
                <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 bg-white dark:bg-zinc-900">
                    <OutlinePanel projectId={projectId} className="px-2" />
                </div>
            )}
        </div>
      ) : null}


      {/* Create dialog */}
      <Dialog
        open={createDialog.open}
        onOpenChange={(open) => setCreateDialog(open ? createDialog : { open: false })}
      >
        {createDialog.open ? (
          <DialogContent className={nestedDialogClassName} overlayClassName={nestedDialogOverlayClassName}>
            <DialogHeader>
              <DialogTitle>
                {createDialog.kind === "folder" ? "Create folder" : "Create file"}
              </DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <Input
                placeholder={createDialog.kind === "folder" ? "Folder name" : "File name (e.g. index.tsx)"}
                value={createDialog.name}
                onChange={(e) =>
                  setCreateDialog((d) =>
                    d.open ? { ...d, name: e.target.value } : d
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") void confirmCreate();
                }}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialog({ open: false })}>
                Cancel
              </Button>
              <Button onClick={() => void confirmCreate()}>Create</Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      {/* Rename dialog */}
      <Dialog
        open={!!renameState.nodeId}
        onOpenChange={(open) => {
          if (!open) setRenameState({ nodeId: null, value: "", original: "" });
        }}
      >
        {renameState.nodeId ? (
          <DialogContent className={nestedDialogClassName} overlayClassName={nestedDialogOverlayClassName}>
            <DialogHeader>
              <DialogTitle>Rename</DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <Input
                placeholder="New name"
                value={renameState.value}
                onChange={(e) => setRenameState((s) => ({ ...s, value: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void confirmRename();
                }}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setRenameState({ nodeId: null, value: "", original: "" })}
              >
                Cancel
              </Button>
              <Button onClick={() => void confirmRename()} disabled={!canEdit}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog((d) => ({ ...d, open, nodes: open ? d.nodes : [] }))}>
        <DialogContent className={nestedDialogClassName} overlayClassName={nestedDialogOverlayClassName}>
          <DialogHeader>
            <DialogTitle>Move to Trash</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-zinc-600 dark:text-zinc-300">
            This will move <span className="font-mono font-semibold">
                {deleteDialog.nodes.length > 1 
                    ? `${deleteDialog.nodes.length} items` 
                    : deleteDialog.nodes[0]?.name}
            </span> to Trash.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, nodes: [] })}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={!canEdit}>
              Move to Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move dialog */}
      <Dialog
        open={moveDialog.open}
        onOpenChange={(open) =>
          setMoveDialog((d) => ({ ...d, open, nodes: open ? d.nodes : [] }))
        }
      >
        <DialogContent className={nestedDialogClassName} overlayClassName={nestedDialogOverlayClassName}>
          <DialogHeader>
            <DialogTitle>Move</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm text-zinc-600 dark:text-zinc-300">
              Move <span className="font-mono font-semibold">
                {moveDialog.nodes.length > 1 
                    ? `${moveDialog.nodes.length} items` 
                    : moveDialog.nodes[0]?.name}
              </span> to:
            </div>
            <FolderPicker
              projectId={projectId}
              selectedFolderId={moveDialog.targetFolderId}
              onSelectFolder={(id) => setMoveDialog((d) => ({ ...d, targetFolderId: id }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialog({ open: false, nodes: [], targetFolderId: null })}>
              Cancel
            </Button>
            <Button onClick={() => void confirmMove()} disabled={!canEdit}>
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Open (Cmd/Ctrl+P) */}
      <Dialog
        open={quickOpen.open}
        onOpenChange={(open) => setQuickOpen((s) => ({ ...s, open }))}
      >
        <DialogContent className={nestedDialogClassName} overlayClassName={nestedDialogOverlayClassName}>
          <DialogHeader>
            <DialogTitle>Quick Open</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              placeholder="Type a filename…"
              value={quickOpen.query}
              onChange={(e) => setQuickOpen((s) => ({ ...s, query: e.target.value }))}
            />
            <div className="max-h-[320px] overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
              {quickOpenLoading ? (
                <div className="p-3 text-sm text-zinc-500 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Searching…
                </div>
              ) : quickOpenResults.length === 0 ? (
                <div className="p-3 text-sm text-zinc-500">No matches</div>
              ) : (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {quickOpenResults.map((n) => (
                    <button
                      key={n.id}
                      className="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 flex items-center gap-2"
                      onClick={() => {
                        setQuickOpen({ open: false, query: "" });
                        handleSelect(n);
                      }}
                    >
                      <FileText className="w-4 h-4 text-zinc-400" />
                      <span className="text-sm font-medium truncate">{n.name}</span>
                      <span className="ml-auto text-xs text-zinc-400">{formatBytes(n.size)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickOpen({ open: false, query: "" })}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Command Palette (Cmd/Ctrl+K) */}
      <Dialog
        open={commandPalette.open}
        onOpenChange={(open) => setCommandPalette((s) => ({ ...s, open }))}
      >
        <DialogContent className={nestedDialogClassName} overlayClassName={nestedDialogOverlayClassName}>
          <DialogHeader>
            <DialogTitle>Commands</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              placeholder="Type a command…"
              value={commandPalette.query}
              onChange={(e) => setCommandPalette((s) => ({ ...s, query: e.target.value }))}
            />
            <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              {[
                {
                  id: "open",
                  label: "Open selected",
                  run: () => selectedNode && handleSelect(selectedNode),
                  disabled: !selectedNode,
                  requiresWrite: false,
                },
                { id: "newFile", label: "New file", run: () => openCreate("file") },
                { id: "newFolder", label: "New folder", run: () => openCreate("folder") },
                {
                  id: "rename",
                  label: "Rename selected",
                  run: () => selectedNode && openRename(selectedNode),
                  disabled: !selectedNode || storeSelectedNodeIds.length > 1,
                },
                {
                  id: "delete",
                  label: "Delete selected",
                  run: () => {
                    if (storeSelectedNodeIds.length > 0) {
                        const nodes = storeSelectedNodeIds.map(id => nodesById[id]).filter(Boolean);
                        openDelete(nodes);
                    } else if (selectedNode) {
                        openDelete(selectedNode);
                    }
                  },
                  disabled: !selectedNode && storeSelectedNodeIds.length === 0,
                },
                {
                  id: "toggleFav",
                  label: "Toggle favorite",
                  run: () => selectedNode && toggleFavorite(projectId, selectedNode.id),
                  disabled: !selectedNode,
                },
                {
                  id: "move",
                  label: "Move selected",
                  run: () => {
                    if (storeSelectedNodeIds.length > 0) {
                      const nodes = storeSelectedNodeIds.map(id => nodesById[id]).filter(Boolean);
                      openMove(nodes);
                    } else if (selectedNode) {
                      openMove(selectedNode);
                    }
                  },
                  disabled: !selectedNode && storeSelectedNodeIds.length === 0,
                },
                {
                  id: "copyPath",
                  label: "Copy selected path",
                  run: async () => {
                    if (!selectedNode) return;
                    const path = getNodePath(selectedNode);
                    if (!path) return;
                    await navigator.clipboard.writeText(path);
                  },
                  disabled: !selectedNode,
                  requiresWrite: false,
                },
              ]
                .filter((c) =>
                  c.label.toLowerCase().includes(commandPalette.query.trim().toLowerCase())
                )
                .map((c) => (
                  <button
                    key={c.id}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900",
                      c.disabled && "opacity-50 cursor-not-allowed"
                    )}
                    disabled={!!c.disabled || (c.requiresWrite !== false && !canEdit)}
                    onClick={async () => {
                      if (c.disabled || (c.requiresWrite !== false && !canEdit)) return;
                      setCommandPalette({ open: false, query: "" });
                      await c.run();
                    }}
                  >
                    {c.label}
                  </button>
                ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommandPalette({ open: false, query: "" })}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FolderPicker({
  projectId,
  selectedFolderId,
  onSelectFolder,
}: {
  projectId: string;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
}) {
  const [rootFolders, setRootFolders] = useState<ProjectNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [children, setChildren] = useState<Record<string, ProjectNode[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const run = async () => {
      const res = await getProjectNodes(projectId, null);
      const nodes = Array.isArray(res) ? res : res.nodes;
      setRootFolders(nodes.filter((n) => n.type === "folder"));
    };
    void run();
  }, [projectId]);

  const toggle = async (node: ProjectNode) => {
    const isOpen = !!expanded[node.id];
    if (isOpen) {
      setExpanded((p) => ({ ...p, [node.id]: false }));
      return;
    }
    setExpanded((p) => ({ ...p, [node.id]: true }));
    if (children[node.id]) return;
    setLoading((p) => ({ ...p, [node.id]: true }));
    try {
      const res = await getProjectNodes(projectId, node.id);
      const nodes = Array.isArray(res) ? res : res.nodes;
      setChildren((p) => ({ ...p, [node.id]: nodes.filter((n) => n.type === "folder") }));
    } finally {
      setLoading((p) => ({ ...p, [node.id]: false }));
    }
  };

  const renderNode = (node: ProjectNode, level: number) => {
    const isOpen = !!expanded[node.id];
    const isSelected = selectedFolderId === node.id;
    return (
      <div key={node.id}>
        <div
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer",
            isSelected && "bg-blue-50 dark:bg-blue-900/20"
          )}
          style={{ paddingLeft: `${level * 14 + 8}px` }}
          onClick={() => onSelectFolder(node.id)}
        >
          <button
            className="w-5 h-5 inline-flex items-center justify-center text-zinc-500"
            onClick={(e) => {
              e.stopPropagation();
              void toggle(node);
            }}
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          {isOpen ? <FolderOpen className="w-4 h-4 text-blue-500" /> : <Folder className="w-4 h-4 text-blue-500" />}
          <span className="text-sm truncate">{node.name}</span>
        </div>
        {isOpen ? (
          loading[node.id] ? (
            <div className="px-2 py-1.5 text-xs text-zinc-500" style={{ paddingLeft: `${(level + 1) * 14 + 8}px` }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin inline-block mr-2" />
              Loading…
            </div>
          ) : (
            (children[node.id] || []).map((c) => renderNode(c, level + 1))
          )
        ) : null}
      </div>
    );
  };

  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 max-h-[280px] overflow-auto">
      <button
        className={cn(
          "w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900",
          selectedFolderId === null && "bg-blue-50 dark:bg-blue-900/20"
        )}
        onClick={() => onSelectFolder(null)}
      >
        Root
      </button>
      <div className="py-1">
        {rootFolders.map((n) => renderNode(n, 0))}
      </div>
    </div>
  );
}
