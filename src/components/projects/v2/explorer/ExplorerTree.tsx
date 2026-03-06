"use client";

import React, { useMemo, useState, useEffect, useRef } from "react";
import { Virtuoso, VirtuosoGrid } from "react-virtuoso";
import { FolderPlus, Loader2, ChevronRight, Home, X, FileText, Image as ImageIcon, Film, Music, Eye } from "lucide-react";
import { FileTreeItem, type FileTreeItemContext } from "./FileTreeItem";
import { FileGridItem } from "./FileGridItem";
import type { ProjectNode } from "@/lib/db/schema";
import type { VisibleRow } from "./utils/buildVisibleRows";
import { buildVisibleRows } from "./utils/buildVisibleRows";
import { isAssetLike, isTextLike } from "../utils/fileKind";
import type { FilesViewMode } from "@/stores/filesWorkspaceStore";
import { filesParentKey } from "@/stores/filesWorkspaceStore";

// --- Asset grid sub-components for VirtuosoGrid ---

type AssetGridListProps = React.HTMLAttributes<HTMLDivElement> & {
  style?: React.CSSProperties;
};

const AssetGridList = React.forwardRef<HTMLDivElement, AssetGridListProps>(
  function AssetGridList({ style, children, ...props }, ref) {
    return (
      <div
        ref={ref}
        {...props}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(var(--grid-min, 100px), 1fr))",
          gap: "8px",
          padding: "8px",
          ...style,
        }}
      >
        {children}
      </div>
    );
  }
);

AssetGridList.displayName = "AssetGridList";

const AssetGridItem = ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div {...props} style={{ padding: 0 }}>
    {children}
  </div>
);

AssetGridItem.displayName = "AssetGridItem";

// --- Visible rows computation ---

export function useVisibleRows(params: {
  projectId: string;
  treeVersion: number;
  explorerMode: string;
  nodesById: Record<string, ProjectNode>;
  childrenByParentId: Record<string, string[]>;
  loadedChildren: Record<string, boolean>;
  expandedFolderIds: Record<string, boolean>;
  folderMeta: Record<string, { nextCursor: string | null; hasMore: boolean }>;
  sort: "name" | "updated" | "type";
  foldersFirst: boolean;
  viewMode: string;
}) {
  const {
    projectId,
    treeVersion,
    explorerMode,
    nodesById,
    childrenByParentId,
    loadedChildren,
    expandedFolderIds,
    folderMeta,
    sort,
    foldersFirst,
    viewMode,
  } = params;

  const [sortedChildren, setSortedChildren] = useState<Record<string, string[]>>({});
  const workerRef = useRef<Worker | null>(null);

  // Initialize Worker
  useEffect(() => {
    workerRef.current = new Worker(new URL('./utils/sort.worker.ts', import.meta.url));
    workerRef.current.onmessage = (e: MessageEvent<{ sortedChildrenByParentId: Record<string, string[]> }>) => {
      setSortedChildren(e.data.sortedChildrenByParentId);
    };
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  // Dispatch Sort Payload
  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({
        jobId: `${projectId}-${treeVersion}-${sort}-${foldersFirst}`,
        nodesById,
        childrenByParentId,
        sort,
        foldersFirst,
      });
    }
  }, [projectId, treeVersion, nodesById, childrenByParentId, sort, foldersFirst]);

  const includeFileByMode = useMemo(() => {
    return (node: ProjectNode) => {
      if (node.type !== "file") return true;
      if (viewMode === "all") return true;
      if (viewMode === "assets") return isAssetLike(node);
      return isTextLike(node) || !isAssetLike(node);
    };
  }, [viewMode]);

  const visibleRows = useMemo(() => {
    return buildVisibleRows({
      projectId,
      treeVersion,
      mode: explorerMode,
      nodesById,
      childrenByParentId,
      loadedChildren,
      expandedFolderIds,
      folderMeta,
      sort,
      foldersFirst,
      viewMode,
      sortedChildrenByParentId: sortedChildren,
      includeNode: (n) => (n.type === "folder" ? true : includeFileByMode(n)),
    });
  }, [
    projectId,
    treeVersion,
    explorerMode,
    nodesById,
    childrenByParentId,
    loadedChildren,
    expandedFolderIds,
    folderMeta,
    sort,
    foldersFirst,
    viewMode,
    sortedChildren,
    includeFileByMode,
  ]);

  return { visibleRows, includeFileByMode };
}

// --- Rows-to-render resolver for all explorer modes ---

export function useRowsToRender(params: {
  effectiveMode: string;
  visibleRows: VisibleRow[];
  searchResults: ProjectNode[];
  trashNodesState: ProjectNode[];
  favorites: Record<string, boolean>;
  recents: string[];
  nodesById: Record<string, ProjectNode>;
  includeFileByMode: (node: ProjectNode) => boolean;
}) {
  const {
    effectiveMode,
    visibleRows,
    searchResults,
    trashNodesState,
    favorites,
    recents,
    nodesById,
    includeFileByMode,
  } = params;

  return useMemo(() => {
    if (effectiveMode === "search") {
      return searchResults
        .filter((n) => n.type === "folder" || includeFileByMode(n))
        .map(
          (n) =>
            ({
              kind: "node",
              nodeId: n.id,
              level: 0,
              parentId: n.parentId ?? null,
              indentationGuides: [],
            }) as VisibleRow
        );
    }
    if (effectiveMode === "favorites") {
      const ids = Object.keys(favorites).filter((id) => favorites[id]);
      const nodes = ids.map((id) => nodesById[id]).filter(Boolean);
      return nodes
        .filter((n) => n.type === "folder" || includeFileByMode(n))
        .map(
          (n) =>
            ({
              kind: "node",
              nodeId: n.id,
              level: 0,
              parentId: n.parentId ?? null,
              indentationGuides: [],
            }) as VisibleRow
        );
    }
    if (effectiveMode === "recents") {
      const nodes = recents.map((id) => nodesById[id]).filter(Boolean);
      return nodes
        .filter((n) => n.type === "folder" || includeFileByMode(n))
        .map(
          (n) =>
            ({
              kind: "node",
              nodeId: n.id,
              level: 0,
              parentId: n.parentId ?? null,
              indentationGuides: [],
            }) as VisibleRow
        );
    }
    if (effectiveMode === "trash") {
      return trashNodesState
        .filter((n) => n.type === "folder" || includeFileByMode(n))
        .map(
          (n) =>
            ({
              kind: "node",
              nodeId: n.id,
              level: 0,
              parentId: n.parentId ?? null,
              indentationGuides: [],
            }) as VisibleRow
        );
    }
    return visibleRows;
  }, [
    effectiveMode,
    includeFileByMode,
    searchResults,
    trashNodesState,
    visibleRows,
    favorites,
    nodesById,
    recents,
  ]);
}

// --- Main tree/grid rendering component ---

export function ExplorerTree({
  rowsToRender,
  contextValue,
  nodesById,
  childrenByParentId,
  effectiveSelectedNodeIds,
  selectedNodeId,
  viewMode,
  effectiveMode,
  isBooting,
  isTrashLoading,
  accessError,
  onSelect,
  onToggleFolder,
  onDropOnFolder,
  onDownloadFolder,
}: {
  rowsToRender: VisibleRow[];
  contextValue: FileTreeItemContext;
  nodesById: Record<string, ProjectNode>;
  childrenByParentId: Record<string, string[]>;
  effectiveSelectedNodeIds: string[];
  selectedNodeId: string | null | undefined;
  viewMode: FilesViewMode;
  effectiveMode: string;
  isBooting: boolean;
  isTrashLoading: boolean;
  accessError: string | null;
  onSelect: (node: ProjectNode, e?: React.MouseEvent) => void;
  onToggleFolder: (node: ProjectNode) => void;
  onDropOnFolder?: (folderId: string, draggedId: string) => void;
  onDownloadFolder: (folderId: string) => void;
}) {
  const [currentAssetFolderId, setCurrentAssetFolderId] = useState<string | null>(null);
  const [gridSize, setGridSize] = useState<"small" | "default" | "large">("default");
  const [isQuickLookOpen, setIsQuickLookOpen] = useState(false);

  // Reset drill-down if we swap views entirely
  useEffect(() => {
    setCurrentAssetFolderId(null);
    setIsQuickLookOpen(false);
  }, [viewMode, effectiveMode]);

  if (accessError) {
    return (
      <div className="p-6 text-sm text-zinc-500">
        <div className="font-semibold text-zinc-900 dark:text-zinc-100">Files unavailable</div>
        <div className="mt-1">
          {accessError === "Forbidden"
            ? "You don't have permission to view this project's files."
            : accessError}
        </div>
      </div>
    );
  }

  if (isBooting || (effectiveMode === "trash" && isTrashLoading)) {
    return (
      <div className="p-6 text-sm text-zinc-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (rowsToRender.length === 0) {
    return (
      <div
        role="status"
        className="flex-1 flex flex-col items-center justify-center p-8 text-center"
      >
        <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
          <FolderPlus className="w-8 h-8 text-zinc-400" />
        </div>
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">
          {effectiveMode === "trash" ? "Trash is empty" : "No files yet"}
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          {effectiveMode === "trash"
            ? "Deleted files will appear here."
            : "Create a file or folder to get started."}
        </p>
      </div>
    );
  }

  if (viewMode === "assets") {
    // 1. O(1) Computation: Only look at children of current folder
    const childIds = childrenByParentId[filesParentKey(currentAssetFolderId)] || [];
    
    // 2. Hydrate & Sort (Folders -> Images/Media -> Docs)
    const assetNodes = childIds
      .map((id: string) => nodesById[id])
      .filter((n: ProjectNode | undefined): n is ProjectNode => !!n && (n.type === "folder" || isAssetLike(n)))
      .sort((a: ProjectNode, b: ProjectNode) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        const aIsMedia = a.mimeType?.startsWith("image/") || a.mimeType?.startsWith("video/") || a.mimeType?.startsWith("audio/");
        const bIsMedia = b.mimeType?.startsWith("image/") || b.mimeType?.startsWith("video/") || b.mimeType?.startsWith("audio/");
        if (aIsMedia && !bIsMedia) return -1;
        if (!aIsMedia && bIsMedia) return 1;
        return a.name.localeCompare(b.name);
      });

    // 3. Breadcrumbs
    const breadcrumbs: ProjectNode[] = [];
    let curr = currentAssetFolderId ? nodesById[currentAssetFolderId] : null;
    while (curr) {
      breadcrumbs.unshift(curr);
      curr = curr.parentId ? nodesById[curr.parentId] : null;
    }

    return (
      <div className="flex flex-col h-full bg-white dark:bg-[#18181b]">
        {/* Breadcrumb Header */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-zinc-200 dark:border-white/10 shrink-0 bg-zinc-50/50 dark:bg-[#18181b]/50">
          <button
            onClick={() => setCurrentAssetFolderId(null)}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Root"
          >
            <Home className="w-4 h-4" />
          </button>
          
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={crumb.id}>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <button
                onClick={() => setCurrentAssetFolderId(crumb.id)}
                className="px-1.5 py-0.5 rounded-md text-xs font-medium text-zinc-700 hover:text-zinc-900 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 truncate max-w-[120px] transition-colors"
                title={crumb.name}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}

          <div className="flex-1" />
          <div className="flex items-center gap-1.5 shrink-0">
            <button
               onClick={() => setIsQuickLookOpen(prev => !prev)}
               className={`p-1.5 rounded-md transition-colors ${isQuickLookOpen ? "bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400" : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800"}`}
               title="Toggle Quick Look"
            >
               <Eye className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 bg-white dark:bg-zinc-800 px-2 py-0.5 rounded-md border border-zinc-200 dark:border-white/10">
              <label className="text-[10px] font-medium text-zinc-500 uppercase">Scale</label>
              <select
                value={gridSize}
                onChange={(e) => setGridSize(e.target.value as any)}
                className="text-xs bg-transparent border-none text-zinc-700 dark:text-zinc-300 cursor-pointer focus:ring-0 appearance-none outline-none"
              >
                <option value="small">Small</option>
                <option value="default">Default</option>
                <option value="large">Large</option>
              </select>
            </div>
          </div>
        </div>

        {/* Grid Wrapper */}
        {assetNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center p-8">
            <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-3">
              <FolderPlus className="w-5 h-5 text-zinc-400" />
            </div>
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Empty folder</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-row relative">
            <div
              className="flex-1 relative"
              style={{ "--grid-min": gridSize === "small" ? "70px" : gridSize === "large" ? "140px" : "100px" } as React.CSSProperties}
            >
              <div className="absolute inset-0">
                <VirtuosoGrid
                  style={{ height: "100%", width: "100%" }}
                  totalCount={assetNodes.length}
                  components={{
                    List: AssetGridList,
                    Item: AssetGridItem,
                  }}
                  itemContent={(index) => {
                    const node = assetNodes[index];
                    return (
                      <FileGridItem
                        node={node}
                        selected={effectiveSelectedNodeIds.includes(node.id) || selectedNodeId === node.id}
                        onSelect={(e) => {
                           e.stopPropagation();
                           onSelect(node, e);
                        }}
                        onDoubleClick={() => {
                          if (node.type === "folder") {
                             setCurrentAssetFolderId(node.id);
                             // Trigger system load if folder contents have not been fetched into memory
                             onToggleFolder(node);
                          }
                          else onSelect(node);
                        }}
                        childrenCount={node.type === "folder" ? (childrenByParentId[filesParentKey(node.id)]?.length || 0) : undefined}
                        onDropOnFolder={onDropOnFolder}
                      />
                    );
                  }}
                />
              </div>
            </div>

            {/* Quick Look Inspector Panel */}
            {(() => {
               const inspectedNodeId = effectiveSelectedNodeIds[0] || selectedNodeId;
               const inspectedNode = inspectedNodeId ? nodesById[inspectedNodeId] : null;

               if (!isQuickLookOpen || !inspectedNode) return null;

               return (
                 <div className="w-[280px] shrink-0 border-l border-zinc-200 dark:border-white/10 bg-zinc-50/50 dark:bg-[#18181b] p-4 flex flex-col gap-4 overflow-y-auto hidden md:flex h-full relative">
                    <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-white/10">
                       <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Quick Look</h3>
                       <button
                         onClick={() => setIsQuickLookOpen(false)}
                         className="p-1 rounded-md text-zinc-400 hover:text-zinc-900 hover:bg-zinc-200 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                       >
                         <X className="w-4 h-4" />
                       </button>
                    </div>

                    <div className="flex flex-col items-center gap-3 pt-2">
                       <div className="w-24 h-24 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center shadow-sm">
                          {inspectedNode.type === "folder" ? (
                            <FolderPlus className="w-10 h-10 text-blue-500" />
                          ) : isAssetLike(inspectedNode) ? (
                            <ImageIcon className="w-10 h-10 text-purple-500" />
                          ) : (
                            <FileText className="w-10 h-10 text-zinc-400" />
                          )}
                       </div>
                       <div className="text-center">
                          <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 break-all">{inspectedNode.name}</h4>
                          <p className="text-xs text-zinc-500 mt-1 capitalize">{inspectedNode.type === "folder" ? "Folder" : inspectedNode.mimeType || "File"}</p>
                       </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2">
                       <div className="flex flex-col gap-1">
                          <span className="text-[10px] uppercase font-semibold text-zinc-400">Size</span>
                          <span className="text-xs text-zinc-700 dark:text-zinc-300">
                             {inspectedNode.type === "folder" 
                               ? `${childrenByParentId[filesParentKey(inspectedNode.id)]?.length || 0} items`
                               : `${Math.round((inspectedNode.size || 0) / 1024)} KB`}
                          </span>
                       </div>
                       <div className="flex flex-col gap-1 mt-2">
                          <span className="text-[10px] uppercase font-semibold text-zinc-400">Created</span>
                          <span className="text-xs text-zinc-700 dark:text-zinc-300">
                             {inspectedNode.createdAt ? new Date(inspectedNode.createdAt).toLocaleDateString() : 'Unknown'}
                          </span>
                       </div>
                       <div className="flex flex-col gap-1 mt-2">
                          <span className="text-[10px] uppercase font-semibold text-zinc-400">Updated</span>
                          <span className="text-xs text-zinc-700 dark:text-zinc-300">
                             {inspectedNode.updatedAt ? new Date(inspectedNode.updatedAt).toLocaleDateString() : 'Unknown'}
                          </span>
                       </div>
                    </div>
                 </div>
               );
            })()}
          </div>
        )}
      </div>
    );
  }

  return (
    <Virtuoso
      data={rowsToRender}
      context={contextValue}
      itemContent={(_, row, context) => (
        <div className="px-2">
          <FileTreeItem row={row} context={context} />
        </div>
      )}
      style={{ height: "100%" }}
    />
  );
}
