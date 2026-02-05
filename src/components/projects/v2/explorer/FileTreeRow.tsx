import React from "react";
import {
    ChevronRight,
    ChevronDown,
    MoreVertical,
    CheckSquare,
    Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FileIcon } from "./FileIcons";
import { ProjectNode } from "@/lib/db/schema";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FileTreeRowProps {
    node: ProjectNode;
    indentationGuides: boolean[];
    isSelected?: boolean;
    isExpanded?: boolean;
    isInSelectionMode?: boolean;
    isSelectedInMode?: boolean;
    canEdit: boolean;
    
    // Slots
    badge?: React.ReactNode;
    menu?: React.ReactNode;

    // Actions
    onToggle: (node: ProjectNode) => void;
    onSelect: (node: ProjectNode, e?: React.MouseEvent) => void;
    onContextMenu: (e: React.MouseEvent) => void;
    onDragStart: (nodeId: string) => void;
    onDragEnd: () => void;
    onDrop: (targetId: string, draggedId: string) => void;
}

function arePropsEqual(prev: FileTreeRowProps, next: FileTreeRowProps) {
    if (
        prev.node !== next.node || 
        prev.isSelected !== next.isSelected ||
        prev.isExpanded !== next.isExpanded ||
        prev.isInSelectionMode !== next.isInSelectionMode ||
        prev.isSelectedInMode !== next.isSelectedInMode ||
        prev.canEdit !== next.canEdit ||
        prev.badge !== next.badge || 
        prev.menu !== next.menu ||
        prev.onToggle !== next.onToggle ||
        prev.onSelect !== next.onSelect ||
        prev.onContextMenu !== next.onContextMenu ||
        prev.onDragStart !== next.onDragStart ||
        prev.onDragEnd !== next.onDragEnd ||
        prev.onDrop !== next.onDrop
    ) {
        return false;
    }

    if (prev.indentationGuides.length !== next.indentationGuides.length) return false;
    for (let i = 0; i < prev.indentationGuides.length; i++) {
        if (prev.indentationGuides[i] !== next.indentationGuides[i]) return false;
    }

    return true;
}

export const FileTreeRow = React.memo(function FileTreeRow({
    node,
    indentationGuides,
    isSelected,
    isExpanded,
    isInSelectionMode,
    isSelectedInMode,
    canEdit,
    badge,
    menu,
    onToggle,
    onSelect,
    onContextMenu,
    onDragStart,
    onDragEnd,
    onDrop
}: FileTreeRowProps) {
    const isFolder = node.type === "folder";

    const guides = indentationGuides.map((active, i) => (
        <div
            key={i}
            className={cn(
                "w-4 h-full flex-shrink-0 border-l transition-colors",
                active ? "border-zinc-200 dark:border-zinc-800" : "border-transparent"
            )}
        />
    ));

    return (
        <div
            className={cn(
                "group flex items-center h-[22px] min-w-0 cursor-pointer select-none transition-colors pr-2",
                isSelected
                    ? "bg-indigo-50 dark:bg-indigo-900/20"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
            )}
            style={{ paddingLeft: 0 }} 
            onClick={(e) => {
                e.stopPropagation();
                onSelect(node, e);
            }}
            onContextMenu={onContextMenu}
            draggable={canEdit}
            onDragStart={(e) => {
                if (!canEdit) return;
                e.dataTransfer.setData("application/x-nb-node", node.id);
                e.dataTransfer.effectAllowed = "move";
                onDragStart(node.id);
            }}
            onDragEnd={onDragEnd}
            onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const draggedId = e.dataTransfer.getData("application/x-nb-node");
                if (draggedId) {
                     onDrop(node.id, draggedId);
                }
            }}
        >
            {guides}
            
            <div 
                className={cn(
                    "w-5 h-full flex items-center justify-center shrink-0",
                    isFolder ? "hover:text-zinc-900 dark:hover:text-zinc-100" : ""
                )}
                onClick={(e) => {
                    if (isFolder) {
                        e.stopPropagation();
                        onToggle(node);
                    }
                }}
            >
                {isFolder ? (
                    isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                    ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                    )
                ) : null}
            </div>

            {isInSelectionMode && (
                <div className="mr-2">
                    {isSelectedInMode ? (
                        <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    ) : (
                        <Square className="w-4 h-4 text-zinc-300 dark:text-zinc-600" />
                    )}
                </div>
            )}

            <FileIcon name={node.name} isFolder={isFolder} isOpen={isExpanded} className="w-4 h-4 mr-2 flex-shrink-0 text-zinc-500" />
            
            <span className={cn(
                "text-sm whitespace-nowrap overflow-hidden text-ellipsis mr-auto",
                isSelected ? "text-indigo-700 dark:text-indigo-300 font-medium" : "text-zinc-700 dark:text-zinc-300"
            )}>
                {node.name}
            </span>

            {badge}

            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center ml-2">
                {menu ? (
                     <DropdownMenu>
                         <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                             <button className="h-5 w-5 flex items-center justify-center rounded-sm hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500">
                                 <MoreVertical className="w-3.5 h-3.5" />
                             </button>
                         </DropdownMenuTrigger>
                         <DropdownMenuContent align="end" className="w-48">
                             {menu}
                         </DropdownMenuContent>
                     </DropdownMenu>
                ) : null}
            </div>
        </div>
    );
}, arePropsEqual);

