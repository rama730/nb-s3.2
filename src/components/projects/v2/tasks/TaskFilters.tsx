"use client";

import React, { useState, useRef, useEffect } from "react";
import { Filter, Check, LayoutGrid, List, Layers, Archive } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useReducedMotionPreference } from "@/components/providers/theme-provider";

interface TaskFiltersProps {
    viewMode: 'board' | 'list';
    setViewMode: (mode: 'board' | 'list') => void;
    scope: 'all' | 'backlog' | 'sprint';
    setScope?: (scope: 'all' | 'backlog' | 'sprint') => void;
}

export default function TaskFilters({
    viewMode,
    setViewMode,
    scope = 'all',
    setScope,
}: TaskFiltersProps) {
    const reduceMotion = useReducedMotionPreference();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen]);

    const hasActiveFilters = scope !== 'all';

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors",
                    hasActiveFilters
                        ? "app-selected-surface border-primary/15"
                        : "bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
                )}
            >
                <Filter className="w-4 h-4" />
                <span>Filter</span>
                {hasActiveFilters && (
                    <span className="flex items-center justify-center min-w-5 h-5 px-1 text-xs font-bold rounded-full bg-primary/10 text-primary">
                        1
                    </span>
                )}
            </button>

            <AnimatePresence initial={!reduceMotion}>
                {isOpen && (
                    <motion.div
                        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.95 }}
                        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.95 }}
                        transition={reduceMotion ? { duration: 0 } : { duration: 0.1 }}
                        className="absolute top-full right-0 z-50 mt-2 w-[340px] max-w-[calc(100vw-2rem)] origin-top-right rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden"
                    >
                        {/* Header */}
                        <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between">
                            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Task Controls</span>
                            {(hasActiveFilters) && (
                                <button
                                    onClick={() => {
                                        setScope?.('all');
                                        setViewMode('board');
                                    }}
                                    className="text-xs text-primary hover:opacity-80 font-medium"
                                >
                                    Reset all
                                </button>
                            )}
                        </div>

                        <div className="p-4 space-y-5 max-h-[70vh] overflow-y-auto">
                            {/* View Mode */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">View</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => setViewMode('board')}
                                        className={cn(
                                            "flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-all",
                                            viewMode === 'board'
                                                ? "app-selected-surface border-primary/15"
                                                : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
                                        )}
                                    >
                                        <LayoutGrid className="w-4 h-4" />
                                        Board
                                    </button>
                                    <button
                                        onClick={() => setViewMode('list')}
                                        className={cn(
                                            "flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-all",
                                            viewMode === 'list'
                                                ? "app-selected-surface border-primary/15"
                                                : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
                                        )}
                                    >
                                        <List className="w-4 h-4" />
                                        List
                                    </button>
                                </div>
                            </div>

                            {/* Scope */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Scope</label>
                                <div className="flex flex-col gap-1">
                                    <button
                                        onClick={() => setScope?.('all')}
                                        className={cn(
                                            "flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors",
                                            scope === 'all'
                                                ? "bg-zinc-100 text-zinc-900 font-medium dark:bg-zinc-800 dark:text-zinc-100"
                                                : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
                                        )}
                                    >
                                        <span className="flex items-center gap-2">
                                            <Layers className="w-4 h-4" />
                                            All Tasks
                                        </span>
                                        {scope === 'all' && <Check className="w-4 h-4 text-primary" />}
                                    </button>
                                    <button
                                        onClick={() => setScope?.('backlog')}
                                        className={cn(
                                            "flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors",
                                            scope === 'backlog'
                                                ? "bg-zinc-100 text-zinc-900 font-medium dark:bg-zinc-800 dark:text-zinc-100"
                                                : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
                                        )}
                                    >
                                        <span className="flex items-center gap-2">
                                            <Archive className="w-4 h-4" />
                                            Backlog Only
                                        </span>
                                        {scope === 'backlog' && <Check className="w-4 h-4 text-primary" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
