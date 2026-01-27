"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import {
    Target,
    Inbox,
    PenTool,
    Layout,
    ChevronRight,
    ChevronLeft,
    X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./WorkspaceContext";
import FocusMode from "./FocusMode";
import TriageMode from "./TriageMode";
import ScratchpadMode from "./ScratchpadMode";
import ContextMode from "./ContextMode";
import TaskDetailView from "./TaskDetailView";

function WorkspaceDock() {
    const { isOpen, isExpanded, mode, toggleOpen, toggleExpanded, setMode, activeTaskId, setActiveTask } = useWorkspace();

    const modeConfig = {
        focus: { icon: Target, label: "Planner", component: FocusMode },
        triage: { icon: Inbox, label: "Triage", component: TriageMode },
        scratchpad: { icon: PenTool, label: "Scratchpad", component: ScratchpadMode },
        context: { icon: Layout, label: "Context", component: ContextMode },
    };

    const ActiveComponent = modeConfig[mode].component;

    return (
        <motion.div
            initial={{ x: "100%" }}
            animate={{ x: isOpen ? 0 : "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30, mass: 0.8 }}
            className={cn(
                "fixed right-0 top-[var(--header-height,64px)] bottom-0 z-50",
                "flex flex-row border-l-2 border-white/20 dark:border-white/10",
                "bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl shadow-2xl",
                "will-change-transform",
                isExpanded ? "w-[500px]" : "w-[60px]"
            )}
            style={{
                visibility: isOpen ? "visible" : "hidden",
                pointerEvents: isOpen ? "auto" : "none"
            }}
        >
            {/* Mini-State / Sidebar Navigation */}
            <div className="w-[60px] shrink-0 flex flex-col items-center py-6 gap-6 bg-zinc-50/50 dark:bg-zinc-900/50 border-r border-zinc-200/50 dark:border-zinc-800/50 z-20">
                {/* Toggle Expand */}
                <button
                    onClick={toggleExpanded}
                    className="p-2 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors text-zinc-500"
                >
                    {isExpanded ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
                </button>

                <div className="flex-1 flex flex-col gap-4">
                    {(Object.keys(modeConfig) as Array<keyof typeof modeConfig>).map((key) => {
                        const Icon = modeConfig[key].icon;
                        const isActive = mode === key;

                        return (
                            <button
                                key={key}
                                onClick={() => {
                                    setMode(key);
                                    if (!isExpanded) toggleExpanded();
                                }}
                                className={cn(
                                    "p-3 rounded-xl transition-all duration-200 relative group",
                                    isActive
                                        ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400"
                                        : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                )}
                                title={modeConfig[key].label}
                            >
                                <Icon size={20} />
                                {/* Tooltip */}
                                {!isExpanded && (
                                    <span className="absolute right-full mr-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                                        {modeConfig[key].label}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Mini Status Indicators (Only when collapsed) */}
                {!isExpanded && (
                    <div className="flex flex-col gap-3 mt-auto">
                        <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse mx-auto" title="3 Urgent Tasks" />
                        <div className="w-2 h-2 rounded-full bg-emerald-500 mx-auto" title="Team Online" />
                    </div>
                )}

                <button
                    onClick={toggleOpen}
                    className="mt-auto p-2 rounded-lg hover:bg-red-100 text-zinc-400 hover:text-red-500 transition-colors"
                >
                    <X size={20} />
                </button>
            </div>

            {/* Expanded Content Area */}
            <div className={cn(
                "flex-1 flex flex-col h-full overflow-hidden transition-opacity duration-200",
                isExpanded ? "opacity-100 delay-100" : "opacity-0 pointer-events-none"
            )}>
                {/* Header */}
                <div className="h-16 shrink-0 border-b border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between px-6">
                    <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100 font-sans tracking-tight">
                        {modeConfig[mode].label}
                    </h2>

                    {/* Contextual Action */}
                    <div className="flex items-center gap-2">
                        {mode === "focus" && (
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full border border-zinc-200 dark:border-zinc-700">
                                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                                    {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Main Content Area */}
                <div className={cn(
                    "flex-1 overflow-x-hidden scrollbar-thin",
                    activeTaskId ? "overflow-hidden p-0" : "overflow-y-auto p-6"
                )}>
                    {activeTaskId ? (
                        <TaskDetailView taskId={activeTaskId} onClose={() => setActiveTask(null)} />
                    ) : (
                        <ActiveComponent />
                    )}
                </div>

                {/* The Shelf (Drop Zone) */}
                <div className="h-20 shrink-0 border-t border-zinc-200/50 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-900/30 p-3">
                    <div className="w-full h-full border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl flex items-center justify-center gap-2 text-zinc-400 transition-colors hover:border-indigo-400 hover:bg-indigo-50/10 hover:text-indigo-500 cursor-pointer">
                        <Inbox size={16} />
                        <span className="text-xs font-medium">Shelf & Temporary Storage</span>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

export default memo(WorkspaceDock);
