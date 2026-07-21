"use client";

import { Briefcase, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/lib/stores/ui-store";

export default function WorkspaceIndicator() {
    const isWorkspaceOpen = useUIStore((s) => s.isWorkspaceOpen);
    const toggleWorkspace = useUIStore((s) => s.toggleWorkspace);

    return (
        <button
            type="button"
            onClick={toggleWorkspace}
            aria-controls="workspace-drawer"
            aria-expanded={isWorkspaceOpen}
            aria-label={isWorkspaceOpen ? "Close workspace drawer" : "Open workspace drawer"}
            className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors group focus:outline-none  ",
                isWorkspaceOpen
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            )}
        >
            <div
                className={cn(
                    "relative flex items-center justify-center w-5 h-5 rounded transition-colors",
                    isWorkspaceOpen
                        ? "bg-blue-100 text-blue-600 dark:bg-blue-800/50 dark:text-blue-400"
                        : "bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 group-hover:text-blue-600 dark:group-hover:text-blue-400"
                )}
            >
                <Briefcase className="w-3 h-3" />
            </div>
            <span className="hidden md:inline">Workspace</span>
            <ChevronRight className="hidden md:block w-3 h-3 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors" />
        </button>
    );
}
