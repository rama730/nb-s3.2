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

interface DraggableTabProps {
  id: string;
  name: string;
  isActive: boolean;
  isDirty: boolean;
  isPinned: boolean;
  onActivate: () => void;
  onClose: () => void;
  onPin: (pinned: boolean) => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
}

export function DraggableTab({
  id,
  name,
  isActive,
  isDirty,
  isPinned,
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : "auto",
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "group flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-default select-none",
        isActive
          ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
          : "bg-transparent border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
      )}
      title={name}
      onMouseDown={(e) => {
        // Prevent activation if clicking close button
        if ((e.target as HTMLElement).closest("button")) return;
        onActivate();
      }}
    >
      <span className="truncate max-w-[160px] text-left">
        {name}
        {isPinned && <Pin className="w-3 h-3 inline ml-1 text-zinc-400" />}
      </span>
      
      {isDirty ? <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" /> : null}

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button 
                className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
                onMouseDown={(e) => e.stopPropagation()} // Stop DnD
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
              <DropdownMenuItem onClick={() => onClose()}>
                Close
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
            onClick={(e) => {
                e.stopPropagation();
                onClose();
            }}
            onMouseDown={(e) => e.stopPropagation()} // Stop DnD
            aria-label="Close tab"
          >
            <X className="w-3 h-3" />
          </button>
      </div>
    </div>
  );
}
