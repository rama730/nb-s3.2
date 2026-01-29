"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
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
import type { ProjectNode } from "@/lib/db/schema";
import {
  createFolder,
  createFileNode,
  getProjectNodes,
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

type VisibleRow =
  | { kind: "node"; nodeId: string; level: number; parentId: string | null; indentationGuides: boolean[] }
  | { kind: "loading"; parentId: string; level: number; indentationGuides: boolean[] }
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
  sort: "name" | "updated" | "type";
  foldersFirst: boolean;
  includeNode?: (node: ProjectNode) => boolean;
}): VisibleRow[] {
  const {
    nodesById,
    childrenByParentId,
    loadedChildren,
    expandedFolderIds,
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
      const isLast = i === sorted.length - 1;
      
      // For the current row, we pass the *current* ancestors state.
      // The `indentationGuides` strictly depends on ancestors. 
      // The "current level" guide state (isLast or not) determines what *children* see, 
      // but for *this* node's own row, we just need to know about parents.
      // Actually, standard tree view drawing uses the ancestors array to draw N vertical lines.
      
      rows.push({ kind: "node", nodeId: id, level, parentId, indentationGuides: ancestors });
      
      const node = nodesById[id];
      if (node?.type === "folder" && expandedFolderIds[id]) {
        const childKey = filesParentKey(id);
        const loaded = !!loadedChildren[childKey];
        // When going deeper, we add the status of THIS level (is it last?) to the ancestors.
        // If this node is NOT last, we need a vertical line for its children -> `!isLast` is true.
        // If this node IS last, we don't draw a line for its children -> `!isLast` is false.
        const nextAncestors = [...ancestors, !isLast];
        
        if (!loaded) {
          rows.push({ kind: "loading", parentId: id, level: level + 1, indentationGuides: nextAncestors });
        } else {
          walk(id, level + 1, nextAncestors);
        }
      }
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
}) {
  const { showToast } = useToast();
  const [accessError, setAccessError] = useState<string | null>(null);


  // Granular selectors for performance (avoid re-rendering tree on file content changes)
  const nodesById = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.nodesById || {});
  const childrenByParentId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.childrenByParentId || {});
  const loadedChildren = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.loadedChildren || {});
  const expandedFolderIds = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.expandedFolderIds || {});
  const explorerMode = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.explorerMode || "tree");
  const searchQuery = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.searchQuery || "");
  const favorites = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.favorites || {});
  const recents = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.recents || []);
  const sort = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.sort || "name");
  const foldersFirst = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.foldersFirst || true);
  const selectedNodeId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.selectedNodeId);
  const selectedFolderId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.selectedFolderId);
  const taskLinkCounts = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.taskLinkCounts || {});

  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);
  const setChildren = useFilesWorkspaceStore((s) => s.setChildren);
  const markChildrenLoaded = useFilesWorkspaceStore((s) => s.markChildrenLoaded);
  const setSelectedNode = useFilesWorkspaceStore((s) => s.setSelectedNode);
  const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);
  const setSearchQuery = useFilesWorkspaceStore((s) => s.setSearchQuery);
  const setSort = useFilesWorkspaceStore((s) => s.setSort);
  const setFoldersFirst = useFilesWorkspaceStore((s) => s.setFoldersFirst);
  const addRecent = useFilesWorkspaceStore((s) => s.addRecent);
  const toggleFavorite = useFilesWorkspaceStore((s) => s.toggleFavorite);
  const setTaskLinkCounts = useFilesWorkspaceStore((s) => s.setTaskLinkCounts);
  const setExplorerMode = useFilesWorkspaceStore((s) => s.setExplorerMode);
  const setViewMode = useFilesWorkspaceStore((s) => s.setViewMode);

  const [isBooting, setIsBooting] = useState(true);
  const [createDialog, setCreateDialog] = useState<
    | { open: false }
    | { open: true; kind: "file" | "folder"; parentId: string | null; name: string }
  >({ open: false });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; node: ProjectNode | null }>({
    open: false,
    node: null,
  });
  const [moveDialog, setMoveDialog] = useState<{
    open: boolean;
    node: ProjectNode | null;
    targetFolderId: string | null;
  }>({ open: false, node: null, targetFolderId: null });
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

  const bootedRef = useRef(false);
  const autoExpandedSystemRootRef = useRef(false);

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const getSupabase = useCallback(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }, []);

  const loadChildren = useCallback(
    async (parentId: string | null, opts?: { force?: boolean }) => {
      const key = filesParentKey(parentId);
      // Read directly from store state to avoid dependency cycle
      const currentWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
      const alreadyLoaded = currentWs?.loadedChildren?.[key];
      
      if (!opts?.force && alreadyLoaded) return;
      try {
        setAccessError(null);
        const nodes = (await getProjectNodes(projectId, parentId)) as ProjectNode[];
        upsertNodes(projectId, nodes);
        setChildren(projectId, parentId, nodes.map((n) => n.id));
        markChildrenLoaded(projectId, parentId);

        // batch fetch link counts for visible files in this listing
        const fileIds = nodes.filter((n) => n.type === "file").map((n) => n.id);
        if (fileIds.length) {
          const counts = await getTaskLinkCounts(projectId, fileIds);
          setTaskLinkCounts(projectId, counts);
        }
      } catch (e: any) {
        const msg = e?.message || "Failed to load files";
        // Avoid throwing into React render; show a clean state instead.
        setAccessError(msg);
      }
    },
    [markChildrenLoaded, projectId, setChildren, setTaskLinkCounts, upsertNodes]
  );

  const boot = useCallback(async () => {
    setIsBooting(true);
    // Avoid repeated forced boots (React strict mode double-invokes effects in dev).
    // Also avoid forcing if already loaded.
    const key = filesParentKey(null);
    const currentWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
    const alreadyLoaded = currentWs?.loadedChildren?.[key];
    if (!bootedRef.current) {
      bootedRef.current = true;
      await loadChildren(null, { force: !alreadyLoaded });
    } else if (!alreadyLoaded) {
      await loadChildren(null);
    }

    // UX: if the project uses a single system "root folder", auto-expand it once
    // so users immediately see files (GitHub-like browsing).
    if (!autoExpandedSystemRootRef.current) {
      autoExpandedSystemRootRef.current = true;
      const ws = useFilesWorkspaceStore.getState().byProjectId[projectId];
      const rootIds = ws?.childrenByParentId?.[filesParentKey(null)] || [];
      if (rootIds.length === 1) {
        const rootNode = ws?.nodesById?.[rootIds[0]];
        const isSystem = !!(rootNode?.metadata as any)?.isSystem;
        if (rootNode?.type === "folder" && isSystem) {
          useFilesWorkspaceStore.getState().toggleExpanded(projectId, rootNode.id, true);
          await loadChildren(rootNode.id);
        }
      }
    }
    setIsBooting(false);
  }, [loadChildren]);

  useEffect(() => {
    void boot();
  }, [boot]);

  // If folders are expanded programmatically (e.g., via breadcrumbs), ensure children are loaded.
  useEffect(() => {
    const expanded = Object.entries(expandedFolderIds)
      .filter(([_, isOpen]) => isOpen)
      .map(([id]) => id);
    if (expanded.length === 0) return;

    for (const folderId of expanded) {
      const key = filesParentKey(folderId);
      if (!loadedChildren[key]) {
        void loadChildren(folderId);
      }
    }
  }, [loadChildren, expandedFolderIds, loadedChildren]);

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
        await loadChildren(parentId, { force: true });
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



  const openDelete = (node: ProjectNode) => {
    if (!canEdit) return;
    setDeleteDialog({ open: true, node });
  };

  const openMove = (node: ProjectNode) => {
    if (!canEdit) return;
    setMoveDialog({ open: true, node, targetFolderId: null });
  };

  const confirmMove = async () => {
    const node = moveDialog.node;
    if (!node) return;
    if (!canEdit) return;

    const target = moveDialog.targetFolderId; // null means root
    if (target === node.id) {
      showToast("Can't move into itself.", "error");
      return;
    }

    // Prevent moving a folder into its own descendant (best-effort using loaded ancestry)
    if (node.type === "folder" && target) {
      let cur: string | null = target;
      for (let i = 0; i < 50; i++) {
        if (!cur) break;
        if (cur === node.id) {
          showToast("Can't move a folder into its own descendant.", "error");
          return;
        }
        cur = nodesById[cur]?.parentId ?? null;
      }
    }

    const oldParentId = node.parentId ?? null;

    try {
      const updated = await moveNode(node.id, target, projectId);
      upsertNodes(projectId, [updated as ProjectNode]);
      await loadChildren(oldParentId, { force: true });
      await loadChildren(target ?? null, { force: true });
      if (target) toggleExpanded(projectId, target, true);
      showToast("Moved", "success");
      setMoveDialog({ open: false, node: null, targetFolderId: null });
    } catch (e: any) {
      showToast(`Move failed: ${e?.message || "Unknown error"}`, "error");
    }
  };

  const confirmDelete = async () => {
    const node = deleteDialog.node;
    if (!node) return;
    if (!canEdit) return;

    try {
      await trashNode(node.id, projectId);
      useFilesWorkspaceStore.getState().removeNodeFromCaches(projectId, node.id);
      onNodeDeleted?.(node.id);
      showToast("Moved to Trash", "success");
      setDeleteDialog({ open: false, node: null });

      // reload parent listing for consistency
      await loadChildren(node.parentId ?? null, { force: true });
    } catch (e: any) {
      showToast(`Delete failed: ${e?.message || "Unknown error"}`, "error");
    }
  };

  const handleToggleFolder = async (node: ProjectNode) => {
    if (node.type !== "folder") return;
    const next = !expandedFolderIds[node.id];
    toggleExpanded(projectId, node.id, next);
    if (next) await loadChildren(node.id);
  };

  const handleSelect = (node: ProjectNode) => {
    if (mode === "select") {
        if (!onSelectionChange) return;

        
        const exists = selectedNodeIds.includes(node.id);
        const newSelection = exists
            ? selectedNodeIds.filter(id => id !== node.id)
            : [...selectedNodeIds, node.id];
        onSelectionChange(newSelection);
        return;
    }

    setSelectedNode(projectId, node.id, node.type === "folder" ? node.id : node.parentId ?? null);
    if (node.type === "file") {
      addRecent(projectId, node.id);
      onOpenFile(node);
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
      if (!selectedNode || !canEdit) return;
      e.preventDefault();
      openDelete(selectedNode);
    }
  };

  const beginDrag = (nodeId: string) => {
    setDraggingId(nodeId);
  };
  const endDrag = () => setDraggingId(null);

  const handleDropOnFolder = async (folderId: string, draggedId: string) => {
    if (!canEdit) return;
    if (folderId === draggedId) return;
    const oldParentId = nodesById[draggedId]?.parentId ?? null;

    try {
      const updated = await moveNode(draggedId, folderId, projectId);
      upsertNodes(projectId, [updated as ProjectNode]);
      showToast("Moved", "success");

      // refresh both old parent and new parent
      await loadChildren(oldParentId, { force: true });
      await loadChildren(folderId, { force: true });
    } catch (e: any) {
      showToast(`Move failed: ${e?.message || "Unknown error"}`, "error");
    }
  };

  const nodeRow = (row: VisibleRow) => {
    if (row.kind === "empty") {
      return (
        <div className="p-8 text-center text-zinc-500 text-sm">
          <div className="font-semibold text-zinc-900 dark:text-zinc-100">{projectName || "Project"}</div>
          <div className="mt-1">No files yet. Create a folder or a file to start.</div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button size="sm" onClick={() => openCreate("folder")} disabled={!canEdit}>
              <Plus className="w-4 h-4 mr-2" />
              New folder
            </Button>
            <Button size="sm" variant="outline" onClick={() => openCreate("file")} disabled={!canEdit}>
              <Plus className="w-4 h-4 mr-2" />
              New file
            </Button>
          </div>
        </div>
      );
    }

    // Indentation guides rendering
    // We render a flex container of 16px wide blocks.
    const guides = row.indentationGuides?.map((active, i) => (
      <div
        key={i}
        className={cn(
          "w-4 h-full flex-shrink-0 border-l transition-colors",
          active ? "border-zinc-200 dark:border-zinc-800" : "border-transparent"
        )}
      />
    ));

    // Pad the guides container to push content
    // The last block is where the chevron/icon goes.
    // If we have N guides, that covers N levels. The content starts at N+1?
    // Actually, `row.level` is the depth. `row.indentationGuides` length should match `row.level`.
    
    // Loading Row
    if (row.kind === "loading") {
      const guides = row.indentationGuides.map((active, i) => (
        <div
          key={i}
          className={cn(
            "w-4 h-full flex-shrink-0 border-l transition-colors",
            active ? "border-zinc-200 dark:border-zinc-800" : "border-transparent"
          )}
        />
      ));
      return (
        <div className="flex items-center h-[22px]">
          {guides}
          <div className="w-4 h-full" />
          <Loader2 className="w-3 h-3 text-zinc-400 animate-spin ml-2" />
        </div>
      );
    }

    // Node Row
    const node = nodesById[row.nodeId];
    if (!node) return null;

    const isFolder = node.type === "folder";
    const expanded = !!expandedFolderIds[node.id];
    const isSelected = selectedNodeId === node.id;
    const isFav = !!favorites[node.id];
    const linkCount = taskLinkCounts[node.id] ?? 0;

    return (
        <FileTreeRow 
            node={node}
            indentationGuides={row.indentationGuides}
            isSelected={isSelected}
            isExpanded={expanded}
            canEdit={canEdit}
            isInSelectionMode={mode === "select"}
            isSelectedInMode={mode === "select" ? selectedNodeIds.includes(node.id) : false}
            
            // Interaction
            onToggle={() => void handleToggleFolder(node)}
            onSelect={() => handleSelect(node)}
            onContextMenu={(e) => {
                e.preventDefault();
            }}
            
            // Drag
            onDragStart={() => beginDrag(node.id)}
            onDragEnd={endDrag}
            onDrop={(draggedId) => {
                 if (isFolder) void handleDropOnFolder(node.id, draggedId);
            }}

            // Badge: Link Count
             badge={linkCount > 0 ? (
                <span className="text-[9px] px-1 rounded-sm bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 flex-shrink-0 font-mono">
                  {linkCount}
                </span>
              ) : null}

            // Menu
            menu={effectiveMode === "trash" ? (
                  <>
                    <DropdownMenuItem
                      onClick={async () => {
                        await restoreNode(node.id, projectId);
                        showToast("Restored", "success");
                        const nodes = (await getTrashNodes(projectId)) as ProjectNode[];
                        setTrashNodesState(nodes);
                        await loadChildren(node.parentId ?? null, { force: true });
                      }}
                      disabled={!canEdit}
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Restore
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async () => {
                        const res = await purgeNode(node.id, projectId);
                        if ((res as any)?.s3Key) {
                          const supabase = getSupabase();
                          await supabase.storage.from("project-files").remove([(res as any).s3Key]);
                        }
                        showToast("Deleted permanently", "success");
                        const nodes = (await getTrashNodes(projectId)) as ProjectNode[];
                        setTrashNodesState(nodes);
                      }}
                      disabled={!canEdit}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete permanently
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuItem onClick={() => openRename(node)} disabled={!canEdit}>
                      <Pencil className="w-4 h-4 mr-2" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openMove(node)} disabled={!canEdit}>
                      <FolderOpen className="w-4 h-4 mr-2" />
                      Move…
                    </DropdownMenuItem>
                     <DropdownMenuItem
                        onClick={() => {
                        toggleFavorite(projectId, node.id);
                        }}
                    >
                        {isFav ? (
                            <>
                                <StarOff className="w-4 h-4 mr-2 text-yellow-500" />
                                Unfavorite
                            </>
                        ) : (
                            <>
                                <Star className="w-4 h-4 mr-2" />
                                Favorite
                            </>
                        )}
                    </DropdownMenuItem>
                    {isFolder ? (
                      <>
                        <DropdownMenuItem
                          onClick={() => {
                            setSelectedNode(projectId, node.id, node.id);
                            openCreate("file");
                          }}
                          disabled={!canEdit}
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          New file
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setSelectedNode(projectId, node.id, node.id);
                            openCreate("folder");
                          }}
                          disabled={!canEdit}
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          New folder
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            openUpload(node.id);
                          }}
                          disabled={!canEdit}
                        >
                          <Upload className="w-4 h-4 mr-2" />
                          Upload
                        </DropdownMenuItem>
                      </>
                    ) : null}
                    <DropdownMenuItem onClick={() => openDelete(node)} disabled={!canEdit} className="text-rose-600 focus:text-rose-600">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Move to Trash
                    </DropdownMenuItem>
                  </>
                )}
        />
    );

  };

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
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            Files
          </div>
          {projectName ? (
            <div className="text-xs text-zinc-400 truncate">{projectName}</div>
          ) : null}
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
          className="h-8"
        />
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs px-2"
            value={viewMode}
            onChange={(e) => setViewMode(projectId, e.target.value as FilesViewMode)}
            title="View mode"
          >
            <option value="code">View: Code</option>
            <option value="assets">View: Assets</option>
            <option value="all">View: All</option>
          </select>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant={explorerMode === "tree" ? "default" : "outline"}
              className="h-7 w-7 p-0"
              onClick={() => setExplorerMode(projectId, "tree")}
              title="All files"
            >
              <List className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant={explorerMode === "favorites" ? "default" : "outline"}
              className="h-7 w-7 p-0"
              onClick={() => setExplorerMode(projectId, "favorites")}
              title="Favorites"
            >
              <Star className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant={explorerMode === "recents" ? "default" : "outline"}
              className="h-7 w-7 p-0"
              onClick={() => setExplorerMode(projectId, "recents")}
              title="Recent files"
            >
              <Clock className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant={explorerMode === "trash" ? "default" : "outline"}
              className="h-7 w-7 p-0"
              onClick={() => setExplorerMode(projectId, "trash")}
              disabled={!canEdit}
              title="Trash"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
          <select
            className="h-8 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs px-2"
            value={sort}
            onChange={(e) => setSort(projectId, e.target.value as any)}
          >
            <option value="name">Sort: Name</option>
            <option value="updated">Sort: Updated</option>
            <option value="type">Sort: Type</option>
          </select>

          {isSearching ? <span className="text-xs text-zinc-400">Searching…</span> : null}
        </div>
      </div>

      {/* List */}
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
        ) : (
          <Virtuoso
            data={rowsToRender}
            context={{
                selectedNodeId,
                selectedNodeIds,
                expandedFolderIds,
                favorites,
                taskLinkCounts,
                mode,
                canEdit
            }}
            itemContent={(_, row) => <div className="px-2">{nodeRow(row)}</div>}
            style={{ height: "100%" }}
          />
        )}
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
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog((d) => ({ ...d, open, node: open ? d.node : null }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to Trash</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-zinc-600 dark:text-zinc-300">
            This will move <span className="font-mono font-semibold">{deleteDialog.node?.name}</span> to Trash.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, node: null })}>
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
          setMoveDialog((d) => ({ ...d, open, node: open ? d.node : null }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm text-zinc-600 dark:text-zinc-300">
              Move <span className="font-mono font-semibold">{moveDialog.node?.name}</span> to:
            </div>
            <FolderPicker
              projectId={projectId}
              selectedFolderId={moveDialog.targetFolderId}
              onSelectFolder={(id) => setMoveDialog((d) => ({ ...d, targetFolderId: id }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialog({ open: false, node: null, targetFolderId: null })}>
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
                  disabled: !selectedNode,
                },
                {
                  id: "delete",
                  label: "Delete selected",
                  run: () => selectedNode && openDelete(selectedNode),
                  disabled: !selectedNode,
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
