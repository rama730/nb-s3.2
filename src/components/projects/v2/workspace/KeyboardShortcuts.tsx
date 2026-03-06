"use client";

import React, { memo } from "react";
import { Keyboard, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const SHORTCUTS = [
  {
    category: "General",
    items: [
      { label: "Command Palette", keys: ["⌘", "K"] },
      { label: "Show Shortcuts", keys: ["⌘", "/"] },
      { label: "Toggle Left Panel", keys: ["⌘", "B"] },
      { label: "Toggle Terminal", keys: ["⌘", "J"] },
      { label: "Zen Mode", keys: ["⌘", "K", "Z"] },
    ],
  },
  {
    category: "Explorer",
    items: [
      { label: "New File", keys: ["⌘", "N"] },
      { label: "New Folder", keys: ["⌘", "⇧", "N"] },
      { label: "Rename", keys: ["Enter", "or", "F2"] },
      { label: "Delete", keys: ["⌘", "⌫"] },
    ],
  },
  {
    category: "Editor",
    items: [
      { label: "Save", keys: ["⌘", "S"] },
      { label: "Find", keys: ["⌘", "F"] },
      { label: "Close Tab", keys: ["⌘", "W"] },
      { label: "Switch Tab", keys: ["^", "Tab"] },
      { label: "Go to Line", keys: ["⌘", "G"] },
    ],
  },
  {
    category: "Terminal",
    items: [
      { label: "Clear", keys: ["⌘", "K"] },
      { label: "Reverse Search", keys: ["^", "R"] },
      { label: "Kill Process", keys: ["^", "C"] },
    ],
  },
];

interface KeyboardShortcutsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Pure component: statically memoized layout, 0 re-calculating per render
export const KeyboardShortcuts = memo(function KeyboardShortcuts({ open, onOpenChange }: KeyboardShortcutsProps) {
  // Return early if not opened to save DOM rendering completely 
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 p-0 overflow-hidden shadow-2xl rounded-xl">
        <DialogHeader className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-900/20">
          <DialogTitle className="flex items-center gap-2 text-lg font-medium text-zinc-900 dark:text-zinc-100">
            <Keyboard className="w-5 h-5 text-zinc-500" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-x-8 gap-y-6 px-6 py-6 bg-white dark:bg-zinc-950">
          {SHORTCUTS.map((section) => (
            <div key={section.category} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                {section.category}
              </h3>
              <div className="space-y-2">
                {section.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between group">
                    <span className="text-sm text-zinc-600 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-200 transition-colors">
                      {item.label}
                    </span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className={cn(
                            "inline-flex items-center justify-center h-5 px-1.5 min-w-[20px] rounded",
                            "text-[11px] font-sans font-medium bg-zinc-100 dark:bg-zinc-800",
                            "border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 shadow-sm"
                          )}
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
});
