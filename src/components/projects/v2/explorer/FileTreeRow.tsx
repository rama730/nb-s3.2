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
    onToggle: () => void;
    onSelect: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
    onDragStart: () => void;
    onDragEnd: () => void;
    onDrop: (draggedId: string) => void;
}

export function FileTreeRow({
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

    // Guides rendering
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
                if (isInSelectionMode) {
                   onSelect();
                } else {
                   // Folder toggles on click too? Standard VS Code behavior is click select, click chevron toggle.
                   // But many web IDEs toggle on click. Let's keep existing logic: Toggle if folder?
                   // No, legacy logic was: Single click SELECTS (and focused).
                   // Only chevron toggled? 
                   // Let's stick to: Click = Select. Chevron = Toggle. Double Click = Toggle?
                   // For now: Click = Select.
                   onSelect();
                }
            }}
            onContextMenu={onContextMenu}
            draggable={canEdit}
            onDragStart={(e) => {
                if (!canEdit) return;
                e.dataTransfer.setData("application/x-nb-node", node.id);
                e.dataTransfer.effectAllowed = "move";
                onDragStart();
            }}
            onDragEnd={onDragEnd}
            onDragOver={(e) => {
                if (!canEdit) return;
                if (isFolder) {
                    e.preventDefault();
                    e.currentTarget.classList.add("bg-indigo-100", "dark:bg-indigo-900/40");
                }
            }}
            onDragLeave={(e) => {
                if (!canEdit) return;
                if (isFolder) {
                    e.currentTarget.classList.remove("bg-indigo-100", "dark:bg-indigo-900/40");
                }
            }}
            onDrop={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.remove("bg-indigo-100", "dark:bg-indigo-900/40");
                const draggedId = e.dataTransfer.getData("application/x-nb-node");
                if (draggedId) {
                   onDrop(draggedId);
                }
            }}
        >
            {/* Guides + Chev */}
            {guides}
            
            <div className="w-4 h-full flex items-center justify-center flex-shrink-0">
                {isFolder && (
                    <div 
                        className="p-0.5 rounded-sm hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggle();
                        }}
                    >
                        {isExpanded ? (
                            <ChevronDown className="w-3 h-3 text-zinc-500" />
                        ) : (
                            <ChevronRight className="w-3 h-3 text-zinc-500" />
                        )}
                    </div>
                )}
            </div>

            {/* Icon */}
            <div className="flex-shrink-0 mr-1.5 ml-0.5">
                <FileIcon 
                    name={node.name} 
                    isFolder={isFolder} 
                    isOpen={isExpanded}
                    size="w-4 h-4"
                />
            </div>

            {/* Name */}
            <span className={cn(
                "truncate text-[13px] transition-colors flex-1 min-w-0",
                isSelected ? "text-indigo-700 dark:text-indigo-300 font-medium" : "text-zinc-700 dark:text-zinc-300",
                node.name.startsWith(".") && "opacity-60"
            )}>
                {node.name}
            </span>

            {/* Badge Slot */}
            {badge && <div className="ml-2 flex-shrink-0">{badge}</div>}

            {/* Selection Checkbox (Optional Mode) */}
            {isInSelectionMode && (
                <div className="ml-2 flex-shrink-0">
                    {isSelectedInMode ? (
                        <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                    ) : (
                        <Square className="w-3.5 h-3.5 text-zinc-300" />
                    )}
                </div>
            )}

            {/* Actions (Hover) */}
            {!isInSelectionMode && menu && (
                <div className="opacity-0 group-hover:opacity-100 flex items-center ml-2">
                    <DropdownMenu>
                         <DropdownMenuTrigger asChild>
                            <button className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700" onClick={e => e.stopPropagation()}>
                                <MoreVertical className="w-3.5 h-3.5 text-zinc-400" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48" onClick={e => e.stopPropagation()}>
                            {menu}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            )}
        </div>
    );
}
