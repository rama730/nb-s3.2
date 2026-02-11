import React from "react";
import { ProjectNode } from "@/lib/db/schema";
import { VisibleRow } from "./FileExplorer";
import { FileTreeRow } from "./FileTreeRow";
import { Button } from "@/components/ui/button";
import {
    ChevronDown,
    FilePlus2,
    FolderOpen,
    FolderPlus,
    Loader2,
    Pencil,
    Plus,
    RotateCcw,
    Star,
    StarOff,
    Trash2,
    Upload,
    FolderInput,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

export interface FileTreeItemContext {
    nodesById: Record<string, ProjectNode>;
    selectedNodeId: string | null;
    selectedNodeIds: string[]; // For multi-select
    expandedFolderIds: Record<string, boolean>;
    favorites: Record<string, boolean>;
    taskLinkCounts: Record<string, number>;
    mode: "default" | "select";
    canEdit: boolean;
    projectName?: string; // For empty state
    
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
    openNode: (node: ProjectNode) => void;
    renameNode: (node: ProjectNode) => void;
    moveNode: (node: ProjectNode) => void;
    deleteNode: (node: ProjectNode) => void;
    toggleFavorite: (nodeId: string) => void;
    restoreNode: (nodeId: string) => void; // For Trash context
    onTaskLinksClick: (node: ProjectNode) => void;
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
        <div className="flex items-center h-[22px]">
          {guides}
          <div className="w-4 h-full" />
          <Loader2 className="w-3 h-3 text-zinc-400 animate-spin ml-2" />
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
    const isFavorite = !!context.favorites[node.id];
    const linkCount = context.taskLinkCounts[node.id] ?? 0;

    const menu =
        context.mode === "select"
            ? null
            : context.isTrashMode ? (
                <DropdownMenuItem
                    onClick={(e) => {
                        e.stopPropagation();
                        context.restoreNode(node.id);
                    }}
                >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Restore
                </DropdownMenuItem>
            ) : (
                <>
                    <DropdownMenuItem
                        onClick={(e) => {
                            e.stopPropagation();
                            context.openNode(node);
                        }}
                    >
                        <FolderOpen className="w-4 h-4 mr-2" />
                        Open
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={(e) => {
                            e.stopPropagation();
                            context.toggleFavorite(node.id);
                        }}
                    >
                        {isFavorite ? <StarOff className="w-4 h-4 mr-2" /> : <Star className="w-4 h-4 mr-2" />}
                        {isFavorite ? "Remove favorite" : "Add favorite"}
                    </DropdownMenuItem>
                    {context.canEdit && node.type === "folder" ? (
                        <>
                            <DropdownMenuItem
                                onClick={(e) => {
                                    e.stopPropagation();
                                    context.createInFolder(node.id, "file");
                                }}
                            >
                                <FilePlus2 className="w-4 h-4 mr-2" />
                                New file
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={(e) => {
                                    e.stopPropagation();
                                    context.createInFolder(node.id, "folder");
                                }}
                            >
                                <FolderPlus className="w-4 h-4 mr-2" />
                                New folder
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={(e) => {
                                    e.stopPropagation();
                                    context.uploadToFolder(node.id);
                                }}
                            >
                                <Upload className="w-4 h-4 mr-2" />
                                Upload file
                            </DropdownMenuItem>
                        </>
                    ) : null}
                    {context.canEdit ? (
                        <>
                            <DropdownMenuItem
                                onClick={(e) => {
                                    e.stopPropagation();
                                    context.renameNode(node);
                                }}
                            >
                                <Pencil className="w-4 h-4 mr-2" />
                                Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={(e) => {
                                    e.stopPropagation();
                                    context.moveNode(node);
                                }}
                            >
                                <FolderInput className="w-4 h-4 mr-2" />
                                Move
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    context.deleteNode(node);
                                }}
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Move to trash
                            </DropdownMenuItem>
                        </>
                    ) : null}
                </>
            );

    return (
        <FileTreeRow 
            node={node}
            indentationGuides={row.indentationGuides}
            isSelected={isSelected}
            isExpanded={expanded}
            canEdit={context.canEdit}
            isInSelectionMode={context.mode === "select"}
            isSelectedInMode={context.mode === "select" ? context.selectedNodeIds.includes(node.id) : false}
            
            // Interaction
            onToggle={context.onToggle}
            onSelect={context.onSelect}
            onContextMenu={(e) => {
                e.preventDefault();
            }}
            
            // Drag
            onDragStart={context.onDragStart}
            onDragEnd={context.onDragEnd}
            onDrop={context.onDrop}

            // Badge: Link Count
             badge={linkCount > 0 ? (
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

            // Menu (Only for trash currently based on original code logic)
            // But 'effectiveMode ===trash' logic was in FileExplorer. 
            // We pass isTrashMode in context.
            menu={menu}
        />
    );
}
