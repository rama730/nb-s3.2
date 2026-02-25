"use client";

import React, { useMemo } from "react";
import { Virtuoso, VirtuosoGrid } from "react-virtuoso";
import { FolderPlus, Loader2 } from "lucide-react";
import { FileTreeItem, type FileTreeItemContext } from "./FileTreeItem";
import { FileGridItem } from "./FileGridItem";
import type { ProjectNode } from "@/lib/db/schema";
import type { VisibleRow } from "./utils/buildVisibleRows";
import { buildVisibleRows } from "./utils/buildVisibleRows";
import { isAssetLike, isTextLike } from "../utils/fileKind";
import type { FilesViewMode } from "@/stores/filesWorkspaceStore";

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
          gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
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
  effectiveSelectedNodeIds,
  selectedNodeId,
  viewMode,
  effectiveMode,
  isBooting,
  isTrashLoading,
  accessError,
  onSelect,
  onToggleFolder,
}: {
  rowsToRender: VisibleRow[];
  contextValue: FileTreeItemContext;
  nodesById: Record<string, ProjectNode>;
  effectiveSelectedNodeIds: string[];
  selectedNodeId: string | null | undefined;
  viewMode: FilesViewMode;
  effectiveMode: string;
  isBooting: boolean;
  isTrashLoading: boolean;
  accessError: string | null;
  onSelect: (node: ProjectNode, e?: React.MouseEvent) => void;
  onToggleFolder: (node: ProjectNode) => void;
}) {
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
    return (
      <VirtuosoGrid
        style={{ height: "100%" }}
        totalCount={rowsToRender.length}
        components={{
          List: AssetGridList,
          Item: AssetGridItem,
        }}
        itemContent={(index) => {
          const row = rowsToRender[index];
          if (row.kind !== "node") return null;
          const node = nodesById[row.nodeId];
          if (!node) return null;

          return (
            <FileGridItem
              node={node}
              selected={effectiveSelectedNodeIds.includes(node.id) || selectedNodeId === node.id}
              onSelect={(e) => onSelect(node, e)}
              onDoubleClick={() => {
                if (node.type === "folder") void onToggleFolder(node);
                else onSelect(node);
              }}
            />
          );
        }}
      />
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
