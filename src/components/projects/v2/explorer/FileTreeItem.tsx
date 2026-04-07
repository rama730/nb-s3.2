import React from "react";
import { ProjectNode } from "@/lib/db/schema";
import { type VisibleRow } from "./utils/buildVisibleRows";
import { FileTreeRow } from "./FileTreeRow";
import { Button } from "@/components/ui/button";
import {
    ChevronDown,
    Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface FileTreeItemContext {
    nodesById: Record<string, ProjectNode>;
    selectedNodeId: string | null;
    selectedNodeIds: string[]; // For multi-select
    expandedFolderIds: Record<string, boolean>;
    favorites: Record<string, boolean>;
    taskLinkCounts: Record<string, number>;
    locksByNodeId: Record<string, { lockedBy: string; lockedByName?: string | null; expiresAt: number }>;
    mode: "default" | "select";
    canEdit: boolean;
    projectName?: string; // For empty state

    // Inline rename
    renameNodeId: string | null;
    renameValue: string;
    onRenameChange: (v: string) => void;
    onRenameConfirm: () => void;
    onRenameCancel: () => void;

    // Desktop drop upload
    onDesktopFileDrop?: (files: File[], targetFolderId: string) => void;

    // Folder sizes
    folderSizes: Record<string, number>;
    treeItemMetaByNodeId: Record<
      string,
      { ariaLevel: number; ariaPosInSet: number; ariaSetSize: number }
    >;
    
    // Handlers
    onToggle: (node: ProjectNode) => void;
    onSelect: (node: ProjectNode, e?: React.MouseEvent) => void;
    onDragStart: (nodeId: string) => void;
    onDragEnd: () => void;
    onDrop: (targetId: string, draggedId: string) => void;
    onLoadMore: (parentId: string | null) => void;
    openCreate: (kind: "file" | "folder") => void;
    createInFolder: (folderId: string | null, kind: "file" | "folder") => void;
    uploadToFolder: (folderId: string | null) => void;
    uploadFolderToFolder: (folderId: string | null) => void;
    downloadFolder: (folderId: string) => void;
    openNode: (node: ProjectNode) => void;
    renameNode: (node: ProjectNode) => void;
    moveNode: (node: ProjectNode) => void;
    deleteNode: (node: ProjectNode) => void;
    toggleFavorite: (nodeId: string) => void;
    restoreNode: (nodeId: string) => void; // For Trash context
    onTaskLinksClick: (node: ProjectNode) => void;
    onContextMenu: (node: ProjectNode, e: React.MouseEvent) => void;
    isTrashMode: boolean;
}

export function FileTreeItem({
    row,
    context
}: {
    row: VisibleRow;
    context: FileTreeItemContext;
}) {
    if (row.kind === "empty") {
      return (
        <div className="p-8 text-center text-zinc-500 text-sm">
          <div className="font-semibold text-zinc-900 dark:text-zinc-100">{context.projectName || "Project"}</div>
          <div className="mt-1">No files yet. Create a folder or a file to start.</div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button size="sm" onClick={() => context.openCreate("folder")} disabled={!context.canEdit}>
              <Plus className="w-4 h-4 mr-2" />
              New folder
            </Button>
            <Button size="sm" variant="outline" onClick={() => context.openCreate("file")} disabled={!context.canEdit}>
              <Plus className="w-4 h-4 mr-2" />
              New file
            </Button>
          </div>
        </div>
      );
    }

    // Indentation guides rendering
    const guides = row.indentationGuides?.map((active, i) => (
      <div
        key={i}
        className={cn(
          "w-4 h-full flex-shrink-0 border-l transition-colors",
          active ? "border-zinc-200 dark:border-zinc-800" : "border-transparent"
        )}
      />
    ));

    // Loading Row
    if (row.kind === "loading") {
      return (
        <div className="flex items-center h-[22px] pointer-events-none opacity-60">
          {guides}
          <div className="w-4 h-full" />
          <div className="flex items-center gap-2 ml-1 mt-0.5 w-full max-w-[140px]">
             <div className="w-3.5 h-3.5 rounded-[3px] bg-zinc-200 dark:bg-zinc-700 animate-pulse shrink-0" />
             <div className="h-2.5 bg-zinc-200 dark:bg-zinc-700 rounded-[2px] animate-pulse w-full" />
          </div>
        </div>
      );
    }

    if (row.kind === "load-more") {
        return (
        <div 
            className="flex items-center h-[22px] hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-blue-500 hover:text-blue-600"
            onClick={(e) => {
                e.stopPropagation();
                const pid = row.parentId === "root" ? null : row.parentId;
                context.onLoadMore(pid);
            }}
        >
            {guides}
            <div className="w-4 h-full" />
            <div className="ml-2 flex items-center gap-1 text-xs font-medium">
            <ChevronDown className="w-3 h-3 opacity-50" />
                Load more...
            </div>
        </div>
        );
    }

    // Node Row
    const node = context.nodesById[row.nodeId];
    if (!node) return null;

    const expanded = !!context.expandedFolderIds[node.id];
    // Multi-select check + Single select check
    const isSelected = context.selectedNodeIds.includes(node.id) || context.selectedNodeId === node.id;
    const linkCount = context.taskLinkCounts[node.id] ?? 0;
    const lock = context.locksByNodeId[node.id];
    const isRenaming = context.renameNodeId === node.id;
    const isFolder = node.type === "folder";
    const folderSize = isFolder ? context.folderSizes[node.id] : undefined;
    const treeItemMeta = context.treeItemMetaByNodeId[node.id];

    // Removed inline Context Menu memory hog - now delegates globally to O(1) Portal

    return (
        <FileTreeRow 
            node={node}
            indentationGuides={row.indentationGuides}
            isSelected={isSelected}
            isExpanded={expanded}
            canEdit={context.canEdit}
            isInSelectionMode={context.mode === "select"}
            isSelectedInMode={context.mode === "select" ? context.selectedNodeIds.includes(node.id) : false}
            
            // Inline rename
            isRenaming={isRenaming}
            renameValue={isRenaming ? context.renameValue : undefined}
            onRenameChange={isRenaming ? context.onRenameChange : undefined}
            onRenameConfirm={isRenaming ? context.onRenameConfirm : undefined}
            onRenameCancel={isRenaming ? context.onRenameCancel : undefined}
            ariaLevel={treeItemMeta?.ariaLevel ?? row.level + 1}
            ariaPosInSet={treeItemMeta?.ariaPosInSet ?? 1}
            ariaSetSize={treeItemMeta?.ariaSetSize ?? 1}

            // Desktop drop upload
            onDesktopDrop={context.onDesktopFileDrop}
            
            // Interaction
            onToggle={context.onToggle}
            onSelect={context.onSelect}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                context.onContextMenu(node, e);
            }}
            
            // Drag
            onDragStart={context.onDragStart}
            onDragEnd={context.onDragEnd}
            onDrop={context.onDrop}

            // Badge: Link Count + Folder Size
            badge={
                <div className="flex items-center gap-1">
                  {isFolder && folderSize !== undefined && folderSize > 0 ? (
                    <span
                      className="text-[9px] px-1 rounded-sm bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex-shrink-0 font-mono tabular-nums"
                      title={`${folderSize.toLocaleString()} bytes total`}
                    >
                      {folderSize < 1024 ? `${folderSize} B` : folderSize < 1048576 ? `${(folderSize / 1024).toFixed(0)}K` : `${(folderSize / 1048576).toFixed(1)}M`}
                    </span>
                  ) : null}
                  {lock ? (
                    <span
                      className="text-[9px] px-1 rounded-sm bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 flex-shrink-0 font-mono"
                      title={`Locked by ${lock.lockedByName?.trim() || "collaborator"}`}
                    >
                      lock
                    </span>
                  ) : null}
                  {linkCount > 0 ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        context.onTaskLinksClick(node);
                      }}
                      className="text-[9px] px-1 rounded-sm bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 flex-shrink-0 font-mono hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors"
                      title="View linked tasks"
                    >
                      {linkCount}
                    </button>
                  ) : null}
                </div>
            }
        />
    );
}
