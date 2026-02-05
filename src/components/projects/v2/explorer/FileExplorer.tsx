"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, VirtuosoGrid } from "react-virtuoso";
import { FileGridItem } from "./FileGridItem";
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Folder,
  FolderOpen,
  List,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Square,
  Star,
  StarOff,
  Trash2,
  Upload,
} from "lucide-react";
import { FileIcon } from "./FileIcons";
import { FileTreeRow } from "./FileTreeRow";
import { FileTreeItem } from "./FileTreeItem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui-custom/Toast";
import { createClient } from "@/lib/supabase/client";
import type { ProjectNode } from "@/lib/db/schema"; // Fixed
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFolder,
  createFileNode,
  getProjectNodes,
  getProjectBatchNodes, // NEW
  getTrashNodes,
  moveNode,
  purgeNode,
  renameNode,
  restoreNode,
  trashNode,
  getTaskLinkCounts,
} from "@/app/actions/files";
import { filesParentKey, useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { FilesViewMode } from "@/stores/filesWorkspaceStore";
import { isAssetLike, isTextLike } from "../utils/fileKind";
import OutlinePanel from "./OutlinePanel";
import SourceControlPanel from "./SourceControlPanel";

export type VisibleRow =
  | { kind: "node"; nodeId: string; level: number; parentId: string | null; indentationGuides: boolean[] }
  | { kind: "loading"; parentId: string; level: number; indentationGuides: boolean[] }
  | { kind: "load-more"; parentId: string; level: number; indentationGuides: boolean[] } // NEW
  | { kind: "empty"; level: number };

function formatBytes(bytes?: number | null) {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function extOf(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
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
  const nodesById = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.nodesById || {});
  const childrenByParentId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.childrenByParentId || {});
  const loadedChildren = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.loadedChildren || {});
  const expandedFolderIds = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.expandedFolderIds || {});
  const folderMeta = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.folderMeta || {}); // NEW
  const explorerMode = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.explorerMode || "tree");
  const searchQuery = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.searchQuery || "");
  const favorites = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.favorites || {});
  const recents = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.recents || []);
  const sort = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.sort || "name");
  const foldersFirst = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.foldersFirst || true);
  const selectedNodeId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.selectedNodeId);
  const storeSelectedNodeIds = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.selectedNodeIds || []);
  const selectedFolderId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.selectedFolderId);
  const taskLinkCounts = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.taskLinkCounts || {});

  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);
  const setChildren = useFilesWorkspaceStore((s) => s.setChildren);
  const markChildrenLoaded = useFilesWorkspaceStore((s) => s.markChildrenLoaded);
  const setFolderMeta = useFilesWorkspaceStore((s) => s.setFolderMeta); // NEW
  const setSelectedNode = useFilesWorkspaceStore((s) => s.setSelectedNode);
  const setSelectedNodeIds = useFilesWorkspaceStore((s) => s.setSelectedNodeIds);
  const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);
  const setSearchQuery = useFilesWorkspaceStore((s) => s.setSearchQuery);
  const setSort = useFilesWorkspaceStore((s) => s.setSort);
  const setFoldersFirst = useFilesWorkspaceStore((s) => s.setFoldersFirst);
  const addRecent = useFilesWorkspaceStore((s) => s.addRecent);
  const toggleFavorite = useFilesWorkspaceStore((s) => s.toggleFavorite);
  const setTaskLinkCounts = useFilesWorkspaceStore((s) => s.setTaskLinkCounts);
  const setExplorerMode = useFilesWorkspaceStore((s) => s.setExplorerMode);
  const setViewMode = useFilesWorkspaceStore((s) => s.setViewMode);

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

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const expandHoverTimer = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});

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
  
  const [isOutlineOpen, setIsOutlineOpen] = useState(false);
  const [isSourceControlOpen, setIsSourceControlOpen] = useState(false);
  // Removed duplicate accessError

  const bootedRef = useRef(false);
  const autoExpandedSystemRootRef = useRef(false);
  const batchLoadedRef = useRef(false);

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const getSupabase = useCallback(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }, []);

  // --- Scalable Data Fetching Logic ---

  // Unified Folder Loader (Refresh or Append)
  const loadFolderContent = useCallback(async (parentId: string | null, mode: 'refresh' | 'append' = 'append') => {
      try {
          const key = filesParentKey(parentId);
          const currentWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
          
          let cursor: string | undefined = undefined;
          let limit = 100;

          if (mode === 'append') {
              // Check if already fully loaded?
              // Actually, we just trust the cursor.
              const meta = currentWs?.folderMeta?.[key];
              cursor = meta?.nextCursor || undefined;
          }

          setAccessError(null);
          
          const res = await getProjectNodes(projectId, parentId, undefined, limit, cursor) as { nodes: ProjectNode[], nextCursor: string | null };
          const newNodes = Array.isArray(res) ? res : res.nodes;
          const nextCursor = !Array.isArray(res) ? res.nextCursor : null;
          
          if (newNodes.length > 0) {
              upsertNodes(projectId, newNodes);
          }

          if (mode === 'refresh') {
              // Replace children
              setChildren(projectId, parentId, newNodes.map(n => n.id));
              setFolderMeta(projectId, parentId, { nextCursor, hasMore: !!nextCursor });
          } else {
              // Append children
              const currentChildrenIds = currentWs?.childrenByParentId?.[key] || [];
              const nextIds = Array.from(new Set([...currentChildrenIds, ...newNodes.map(n => n.id)]));
              setChildren(projectId, parentId, nextIds);
              setFolderMeta(projectId, parentId, { nextCursor, hasMore: !!nextCursor });
          }
          
          markChildrenLoaded(projectId, parentId);

          // Fetch counts for new files
          const fileIds = newNodes.filter((n) => n.type === "file").map((n) => n.id);
          if (fileIds.length) {
            const counts = await getTaskLinkCounts(projectId, fileIds);
            setTaskLinkCounts(projectId, counts);
          }
          
      } catch (e: any) {
          console.error("Load folder failed", e);
          if (mode === 'refresh') {
              setAccessError(e?.message || "Failed to load files");
          } else {
              showToast("Failed to load more files", "error");
          }
      }
  }, [projectId, upsertNodes, setChildren, markChildrenLoaded, setFolderMeta, setTaskLinkCounts]);

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
             if (rootNode && (rootNode.metadata as any)?.isSystem && rootNode.type === "folder") {
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
  const handleToggleFolder = async (node: ProjectNode) => {
    if (node.type !== "folder") return;
    const next = !expandedFolderIds[node.id];
    toggleExpanded(projectId, node.id, next);
    
    if (next) {
        // Check if loaded
        const key = filesParentKey(node.id);
        const loaded = loadedChildren[key];
        if (!loaded) {
            // Fetch first page
            await loadFolderContent(node.id, 'refresh');
        }
    }
  };

  // Helper for load more button
  const handleLoadMore = (folderId: string | null) => {
      void loadFolderContent(folderId, 'append');
  };

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



  const openCreate = (kind: "file" | "folder") => {
    if (!canEdit) return;
    const parentId =
      selectedNode?.type === "folder"
        ? selectedNode.id
        : selectedNode?.parentId ?? selectedFolderId ?? null;
    setCreateDialog({ open: true, kind, parentId, name: "" });
  };

  const confirmCreate = async () => {
    if (!createDialog.open) return;
    const name = createDialog.name.trim();
    if (!name) return;
    if (!canEdit) return;

    try {
      // Duplicate validation within parent
      const parentId = createDialog.parentId ?? null;
      if (!loadedChildren[filesParentKey(parentId)]) {
        // Load siblings for accurate validation (one-time)
        await loadFolderContent(parentId, 'refresh');
      }
      const siblingIds = childrenByParentId[filesParentKey(parentId)] || [];
      const siblings = siblingIds.map((id) => nodesById[id]).filter(Boolean);
      const dup = siblings.some((s) => s.name.toLowerCase() === name.toLowerCase());
      if (dup) {
        showToast("A file/folder with that name already exists here.", "error");
        return;
      }


      if (createDialog.kind === "folder") {
        const node = await createFolder(projectId, parentId, name);
        // Optimistic update: cache node
        upsertNodes(projectId, [node as ProjectNode]);
        
        // Optimistic update: append to parent's child list
        const parentKey = filesParentKey(parentId);
        const currentChildren = childrenByParentId[parentKey] || [];
        // prevent duplicate id entry if server returns same id for some reason (rare)
        if (!currentChildren.includes(node.id)) {
             setChildren(projectId, parentId, [...currentChildren, node.id]);
        }
      } else {
        const fileExt = name.includes(".") ? name.split(".").pop() : "txt";
        const storagePath = `projects/${projectId}/${Math.random().toString(36).substring(2)}.${fileExt}`;
        const supabase = getSupabase();
        const emptyBlob = new Blob([""], { type: "text/plain" });
        const { error: uploadError } = await supabase.storage
          .from("project-files")
          .upload(storagePath, emptyBlob);
        if (uploadError) throw uploadError;

        const node = await createFileNode(projectId, parentId, {
          name,
          s3Key: storagePath,
          size: 0,
          mimeType: "text/plain",
        });
        
        // Optimistic update
        upsertNodes(projectId, [node as ProjectNode]);
        const parentKey = filesParentKey(parentId);
        const currentChildren = childrenByParentId[parentKey] || [];
        if (!currentChildren.includes(node.id)) {
             setChildren(projectId, parentId, [...currentChildren, node.id]);
        }
      }

      // No need to await loadChildren(parentId, { force: true }); -> instant show
      if (parentId) toggleExpanded(projectId, parentId, true);
      showToast("Created", "success");
      setCreateDialog({ open: false });
    } catch (e: any) {
      showToast(`Create failed: ${e?.message || "Unknown error"}`, "error");
    }
  };

  const openUpload = (parentId: string | null) => {
    if (!canEdit) return;
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
            const supabase = getSupabase();
            const ext = file.name.split(".").pop();
            const fileName = `${Math.random().toString(36).substring(2)}.${ext}`;
            const filePath = `projects/${projectId}/${fileName}`;
            const { error } = await supabase.storage.from("project-files").upload(filePath, file);
            if (error) throw error;
            const node = await createFileNode(projectId, parentId, {
                name: file.name,
                s3Key: filePath,
                size: file.size,
                mimeType: file.type,
            });
            upsertNodes(projectId, [node as ProjectNode]);
            
            // Optimistic update
            const parentKey = filesParentKey(parentId);
            const currentChildren = childrenByParentId[parentKey] || [];
            if (!currentChildren.includes(node.id)) {
                 setChildren(projectId, parentId, [...currentChildren, node.id]);
            }
            
            // await loadChildren(parentId); // REMOVED for speed
            
            if (parentId) toggleExpanded(projectId, parentId, true);
            
            // Auto-open logic
            onOpenFile(node as ProjectNode);
            
            showToast("Uploaded", "success");
        } catch (e: any) {
            showToast(`Upload failed: ${e?.message || "Unknown error"}`, "error");
        }
    };
    input.click();
  };

  const openRename = (node: ProjectNode) => {
    if (!canEdit) return;
    setRenameState({ nodeId: node.id, value: node.name, original: node.name });
  };



  const openDelete = (nodeOrNodes: ProjectNode | ProjectNode[]) => {
    if (!canEdit) return;
    const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
    setDeleteDialog({ open: true, nodes });
  };

  const openMove = (nodeOrNodes: ProjectNode | ProjectNode[]) => {
    if (!canEdit) return;
    const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
    setMoveDialog({ open: true, nodes, targetFolderId: null });
  };

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

    try {
        await Promise.all(nodes.map(async (node) => {
            const oldParentId = node.parentId ?? null;
            const updated = await moveNode(node.id, target, projectId);
            upsertNodes(projectId, [updated as ProjectNode]);
            // refresh old parent (inefficient if many, but safe)
            if (oldParentId !== target) {
               await loadFolderContent(oldParentId, 'refresh');
            }
        }));

        await loadFolderContent(target ?? null, 'refresh');
        if (target) toggleExpanded(projectId, target, true);
        
        showToast(`Moved ${nodes.length} item${nodes.length > 1 ? 's' : ''}`, "success");
        setMoveDialog({ open: false, nodes: [], targetFolderId: null });
    } catch (e: any) {
        showToast(`Move failed: ${e?.message || "Unknown error"}`, "error");
    }
  };

  const confirmDelete = async () => {
    const nodes = deleteDialog.nodes;
    if (!nodes.length) return;
    if (!canEdit) return;

    try {
      await Promise.all(nodes.map(async (node) => {
          await trashNode(node.id, projectId);
          useFilesWorkspaceStore.getState().removeNodeFromCaches(projectId, node.id);
          onNodeDeleted?.(node.id);
          // reload parent listing
          await loadFolderContent(node.parentId ?? null, 'refresh');
      }));

      showToast(`Moved ${nodes.length} item${nodes.length > 1 ? 's' : ''} to Trash`, "success");
      setDeleteDialog({ open: false, nodes: [] });
    } catch (e: any) {
      showToast(`Delete failed: ${e?.message || "Unknown error"}`, "error");
    }
  };




  // Search mode: server-backed (ilike) + client filtering for responsiveness.
  const [searchResults, setSearchResults] = useState<ProjectNode[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [trashNodesState, setTrashNodesState] = useState<ProjectNode[]>([]);
  const [isTrashLoading, setIsTrashLoading] = useState(false);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }

    const t = setTimeout(async () => {
      setIsSearching(true);
      try {
        const nodes = (await getProjectNodes(projectId, null, q)) as ProjectNode[];
        upsertNodes(projectId, nodes);
        setSearchResults(nodes);

        const fileIds = nodes.filter((n) => n.type === "file").map((n) => n.id);
        if (fileIds.length) {
          const counts = await getTaskLinkCounts(projectId, fileIds);
          setTaskLinkCounts(projectId, counts);
        }
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(t);
  }, [projectId, upsertNodes, searchQuery]);

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

    const t = setTimeout(async () => {
      setQuickOpenLoading(true);
      try {
        const nodes = (await getProjectNodes(projectId, null, q)) as ProjectNode[];
        const files = nodes.filter((n) => n.type === "file").slice(0, 50);
        upsertNodes(projectId, files);
        setQuickOpenResults(files);
      } finally {
        setQuickOpenLoading(false);
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

    if (mode === "select") {
        if (!onSelectionChange) return;
        // Use prop directly, assuming it's stable or we accept dependency.
        const currentSelected = useFilesWorkspaceStore.getState().byProjectId[projectId]?.selectedNodeIds || [];
        const exists = currentSelected.includes(node.id);
        const newSelection = exists
            ? currentSelected.filter(id => id !== node.id)
            : [...currentSelected, node.id];
        onSelectionChange(newSelection);
        return;
    }

    setSelectedNodeIds(projectId, [node.id]);
    setSelectedNode(projectId, node.id, node.type === "folder" ? node.id : node.parentId ?? null);
    if (node.type === "file") {
      addRecent(projectId, node.id);
      onOpenFile(node);
    }
  }, [projectId, rowsToRender, mode, onSelectionChange, selectedNodeId, upsertNodes, setSelectedNode, setSelectedNodeIds, addRecent, onOpenFile]);

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
    }
  };

  const beginDrag = (nodeId: string) => {
    setDraggingId(nodeId);
  };
  const endDrag = () => setDraggingId(null);

  const handleDropOnFolder = async (folderId: string, draggedId: string) => {
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

    try {
      let movedCount = 0;
      await Promise.all(nodesToMove.map(async (id) => {
          const oldParentId = nodesById[id]?.parentId ?? null;
          // Prevent moving into self or descendant (simple check)
          if (id === folderId) return; 
          
          const updated = await moveNode(id, folderId, projectId);
          upsertNodes(projectId, [updated as ProjectNode]);
          movedCount++;

          // refresh old parent
          if (oldParentId && oldParentId !== folderId) {
             await loadFolderContent(oldParentId, 'refresh');
          }
      }));

      if (movedCount > 0) {
        showToast(`Moved ${movedCount} item${movedCount > 1 ? 's' : ''}`, "success");
        await loadFolderContent(folderId, 'refresh');
        toggleExpanded(projectId, folderId, true);
      }
    } catch (e: any) {
      showToast(`Move failed: ${e?.message || "Unknown error"}`, "error");
    }
  };








  // Stable Context for FileTreeItem
  const contextValue = useMemo(() => ({
    // State
    nodesById,
    selectedNodeId,
    selectedNodeIds: storeSelectedNodeIds,
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
    onDragStart: (nodeId: string) => beginDrag(nodeId),
    onDragEnd: () => endDrag(),
    onDrop: (targetId: string, draggedId: string) => void handleDropOnFolder(targetId, draggedId),
    onLoadMore: (pid: string | null) => handleLoadMore(pid),
    openCreate: (kind: "file" | "folder") => openCreate(kind),
    restoreNode: async (id: string) => {
        await restoreNode(id, projectId);
        showToast("Restored", "success");
        const nodes = (await getTrashNodes(projectId)) as ProjectNode[];
        setTrashNodesState(nodes);
        const node = nodesById[id];
        if (node?.parentId) await loadFolderContent(node.parentId, 'refresh');
    }
  }), [
    nodesById,
    selectedNodeId,
    storeSelectedNodeIds,
    expandedFolderIds,
    favorites,
    taskLinkCounts,
    mode,
    canEdit,
    projectName,
    effectiveMode,
    handleSelect // added dep
  ]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="h-full flex flex-col bg-white dark:bg-zinc-900 outline-none"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 p-3 border-b border-zinc-200 dark:border-zinc-800">
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

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => openCreate("folder")}
            disabled={!canEdit}
            title="New folder"
          >
            <Plus className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => openCreate("file")}
            disabled={!canEdit}
            title="New file"
          >
            <FileText className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => {
              if (!canEdit) return;
              const parentId =
                selectedNode?.type === "folder"
                  ? selectedNode.id
                  : selectedNode?.parentId ?? selectedFolderId ?? null;
              openUpload(parentId);
            }}
            disabled={!canEdit}
            title="Upload file"
          >
            <Upload className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Search & sort */}
      <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 space-y-2">
        <Input
          placeholder="Search files…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(projectId, e.target.value)}
          className="h-8 bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
        />
        <div className="flex items-center gap-2">
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
          <select
            className="h-7 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs px-2 cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500/20"
            value={sort}
            onChange={(e) => setSort(projectId, e.target.value as any)}
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
                    List: React.forwardRef(({ style, children, ...props }: any, ref) => (
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
                    )),
                    Item: ({ children, ...props }: any) => (
                        <div {...props} style={{ padding: 0 }}>{children}</div>
                    )
                }}
                itemContent={(index) => {
                    const row = rowsToRender[index];
                    if (row.kind !== 'node') return null;
                    const node = nodesById[row.nodeId];
                    if (!node) return null;
                    
                    return (
                        <FileGridItem
                            node={node}
                            selected={storeSelectedNodeIds.includes(node.id) || selectedNodeId === node.id}
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
          <DialogContent>
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

      {/* Delete dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog((d) => ({ ...d, open, nodes: open ? d.nodes : [] }))}>
        <DialogContent>
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
        <DialogContent>
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
        <DialogContent>
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
        <DialogContent>
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
                    disabled={!!c.disabled || !canEdit}
                    onClick={() => {
                      if (c.disabled || !canEdit) return;
                      setCommandPalette({ open: false, query: "" });
                      c.run();
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
      const nodes = (await getProjectNodes(projectId, null)) as ProjectNode[];
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
      const nodes = (await getProjectNodes(projectId, node.id)) as ProjectNode[];
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
