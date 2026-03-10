"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { MoreVertical, Pin, PinOff, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileIcon } from "./explorer/FileIcons";

interface DraggableTabProps {
  id: string;
  name: string;
  title?: string;
  isActive: boolean;
  isDirty: boolean;
  isPinned: boolean;
  compact?: boolean;
  onActivate: () => void;
  onClose: () => void;
  onPin: (pinned: boolean) => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
}

export function DraggableTab({
  id,
  name,
  title,
  isActive,
  isDirty,
  isPinned,
  compact,
  onActivate,
  onClose,
  onPin,
  onCloseOthers,
  onCloseToRight,
}: DraggableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const [confirmingClose, setConfirmingClose] = React.useState(false);

  // Auto-dismiss confirm prompt if file becomes non-dirty (e.g. auto-save)
  React.useEffect(() => {
    if (!isDirty) setConfirmingClose(false);
  }, [isDirty]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : "auto",
    opacity: isDragging ? 0.5 : 1,
  };

  const handleClose = () => {
    if (isDirty) {
      setConfirmingClose(true);
    } else {
      onClose();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      handleClose();
    }
  };

  // Compact mode: Just icon + pin for inactive pinned tabs
  if (compact) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        role="tab"
        aria-selected={isActive}
        aria-label={title || name}
        tabIndex={isActive ? 0 : -1}
        className={cn(
          "group flex items-center gap-0.5 px-1.5 py-1.5 rounded-md text-xs border transition-colors cursor-default select-none",
          "bg-transparent border-transparent text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
        )}
        title={title || name}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          onActivate();
        }}
        onKeyDown={handleKeyDown}
      >
        <FileIcon name={name} isFolder={false} className="w-3.5 h-3.5 flex-shrink-0" />
        {isPinned && <Pin className="w-2.5 h-2.5 text-zinc-400" />}
        {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      aria-label={title || name}
      tabIndex={isActive ? 0 : -1}
      className={cn(
        "group flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-default select-none",
        isActive
          ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
          : "bg-transparent border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
      )}
      title={title || name}
      onMouseDown={(e) => {
        // Prevent activation if clicking close button
        if ((e.target as HTMLElement).closest("button")) return;
        onActivate();
      }}
      onKeyDown={handleKeyDown}
    >
      <span className="truncate max-w-[160px] text-left">
        {name}
        {isPinned && <Pin className="w-3 h-3 inline ml-1 text-zinc-400" />}
      </span>
      
      {isDirty ? <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" /> : null}

      {/* Inline unsaved close confirmation */}
      {confirmingClose ? (
        <div className="flex items-center gap-1 animate-in fade-in zoom-in-95 duration-100">
          <button
            type="button"
            className="px-1.5 py-0.5 text-[10px] rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors font-semibold"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            Discard
          </button>
          <button
            type="button"
            className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
            onClick={(e) => { e.stopPropagation(); setConfirmingClose(false); }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button 
                className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
                onMouseDown={(e) => e.stopPropagation()} // Stop DnD
                aria-label={`Tab actions for ${name}`}
              >
                <MoreVertical className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onPin(!isPinned)}>
                {isPinned ? <PinOff className="w-4 h-4 mr-2" /> : <Pin className="w-4 h-4 mr-2" />}
                {isPinned ? "Unpin" : "Pin"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCloseToRight()}>
                Close to right
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCloseOthers()}>
                Close others
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleClose()}>
                Close
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
            onClick={(e) => {
                e.stopPropagation();
                handleClose();
            }}
            onMouseDown={(e) => e.stopPropagation()} // Stop DnD
            aria-label="Close tab"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
