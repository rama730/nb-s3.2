import React from "react";
import {
    ChevronRight,
    ChevronDown,
    CheckSquare,
    Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FileIcon } from "./FileIcons";
import { ProjectNode } from "@/lib/db/schema";

const NODE_DRAG_MIME = "application/x-nb-node";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extractDraggedNodeId(dataTransfer: DataTransfer): string | null {
    const raw = dataTransfer.getData(NODE_DRAG_MIME).trim();
    if (!raw) return null;
    return UUID_PATTERN.test(raw) ? raw : null;
}

// ─── Inline Rename Input ─────────────────────────────────────────────
function InlineRenameInput({
    value,
    onChange,
    onConfirm,
    onCancel,
}: {
    value: string;
    onChange: (v: string) => void;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const cancelledRef = React.useRef(false);

    React.useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        // Select filename without extension
        const dotIdx = value.lastIndexOf(".");
        el.setSelectionRange(0, dotIdx > 0 ? dotIdx : value.length);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
                if (e.key === "Escape") {
                    e.preventDefault();
                    cancelledRef.current = true;
                    onCancel();
                }
            }}
            onBlur={() => {
                // Skip onConfirm if Escape was pressed (race condition guard)
                if (cancelledRef.current) return;
                onConfirm();
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-sm bg-white dark:bg-zinc-900 border border-indigo-400 dark:border-indigo-500 rounded px-1 py-0 outline-none ring-1 ring-indigo-300/50 w-full min-w-[60px] mr-auto"
        />
    );
}

// ─── FileTreeRow ─────────────────────────────────────────────────────
interface FileTreeRowProps {
    node: ProjectNode;
    indentationGuides: boolean[];
    isSelected?: boolean;
    isExpanded?: boolean;
    isInSelectionMode?: boolean;
    isSelectedInMode?: boolean;
    canEdit: boolean;

    // Inline rename
    isRenaming?: boolean;
    renameValue?: string;
    onRenameChange?: (v: string) => void;
    onRenameConfirm?: () => void;
    onRenameCancel?: () => void;
    
    // Slots
    badge?: React.ReactNode;

    // Desktop drop upload
    onDesktopDrop?: (files: File[], targetFolderId: string) => void;

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
        prev.isRenaming !== next.isRenaming ||
        prev.renameValue !== next.renameValue ||
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
    isRenaming,
    renameValue,
    onRenameChange,
    onRenameConfirm,
    onRenameCancel,
    badge,
    onDesktopDrop,
    onToggle,
    onSelect,
    onContextMenu,
    onDragStart,
    onDragEnd,
    onDrop
}: FileTreeRowProps) {
    const isFolder = node.type === "folder";

    const [dropHighlight, setDropHighlight] = React.useState(false);

    const handleMouseEnter = () => {
        if (isRenaming) return;
    };

    const handleMouseLeave = () => {
    };

    const guides = indentationGuides.map((active, i) => (
        <div
            key={i}
            className={cn(
                "w-4 h-full flex-shrink-0 border-l transition-colors",
                active ? "border-zinc-300 dark:border-zinc-700" : "border-transparent"
            )}
        />
    ));

    return (
        <div
            data-workspace-file-item="true"
            data-node-id={node.id}
            className={cn(
                "group relative flex items-center h-[22px] min-w-0 cursor-pointer select-none transition-colors pr-2",
                isSelected
                    ? "bg-indigo-50 dark:bg-indigo-900/20 border-l-2 border-l-indigo-500"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800/50 border-l-2 border-l-transparent",
                dropHighlight && "ring-2 ring-inset ring-indigo-400 bg-indigo-50/60 dark:bg-indigo-900/30"
            )}
            style={{ paddingLeft: 0 }} 
            onClick={(e) => {
                if (isRenaming) return;
                e.stopPropagation();
                onSelect(node, e);
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onContextMenu={onContextMenu}
            draggable={canEdit && !isRenaming}
            onDragStart={(e) => {
                if (!canEdit || isRenaming) return;
                e.dataTransfer.setData(NODE_DRAG_MIME, node.id);
                e.dataTransfer.effectAllowed = "move";
                onDragStart(node.id);
            }}
            onDragEnd={onDragEnd}
            onDragOver={(e) => {
                e.preventDefault();
                // Accept desktop file drops on folders
                const hasFiles = e.dataTransfer.types.includes("Files");
                const hasNodeDrag = e.dataTransfer.types.includes(NODE_DRAG_MIME);
                if (isFolder && hasFiles) {
                    e.dataTransfer.dropEffect = "copy";
                } else if (isFolder && hasNodeDrag) {
                    e.dataTransfer.dropEffect = "move";
                } else {
                    e.dataTransfer.dropEffect = "move";
                }
                if (isFolder && (hasFiles || hasNodeDrag) && !dropHighlight) setDropHighlight(true);
            }}
            onDragLeave={() => setDropHighlight(false)}
            onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDropHighlight(false);
 
                // Desktop file drop → upload into this folder
                if (isFolder && e.dataTransfer.files.length > 0 && onDesktopDrop) {
                    const files = Array.from(e.dataTransfer.files);
                    onDesktopDrop(files, node.id);
                    return;
                }
 
                if (!e.dataTransfer.types.includes(NODE_DRAG_MIME)) return;
                const draggedId = extractDraggedNodeId(e.dataTransfer);
                if (!draggedId || draggedId === node.id) return;
                onDrop(node.id, draggedId);
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
            
            {isRenaming && onRenameChange && onRenameConfirm && onRenameCancel ? (
                <InlineRenameInput
                    value={renameValue ?? ""}
                    onChange={onRenameChange}
                    onConfirm={onRenameConfirm}
                    onCancel={onRenameCancel}
                />
            ) : (
                <span className={cn(
                    "text-sm whitespace-nowrap overflow-hidden text-ellipsis mr-auto",
                    isSelected ? "text-indigo-700 dark:text-indigo-300 font-medium" : "text-zinc-700 dark:text-zinc-300"
                )}>
                    {node.name}
                </span>
            )}
 
            {badge}
        </div>
    );
}, arePropsEqual);
