"use client";

import React, { useState, useRef, useEffect } from "react";
import { Filter, ChevronDown, Check, LayoutGrid, List, Layers, Archive, CheckSquare, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface TaskFiltersProps {
    viewMode: 'board' | 'list';
    setViewMode: (mode: 'board' | 'list') => void;
    scope: 'all' | 'backlog' | 'sprint';
    setScope?: (scope: 'all' | 'backlog' | 'sprint') => void;
    activeCount?: number;
    isBulkMode?: boolean;
    setBulkMode?: (enabled: boolean) => void;
    isReorderMode?: boolean;
    setReorderMode?: (enabled: boolean) => void;
    selectedCount?: number;
}

export default function TaskFilters({
    viewMode,
    setViewMode,
    scope = 'all',
    setScope,
    activeCount = 0,
    isBulkMode = false,
    setBulkMode,
    isReorderMode = false,
    setReorderMode,
    selectedCount = 0,
}: TaskFiltersProps) {
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

    const hasActiveFilters = activeCount > 0 || scope !== 'all' || isBulkMode;

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors",
                    hasActiveFilters
                        ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300"
                        : "bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
                )}
            >
                <Filter className="w-4 h-4" />
                <span>Filter</span>
                {hasActiveFilters && (
                    <span className="flex items-center justify-center min-w-5 h-5 px-1 text-xs font-bold rounded-full bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-200">
                        {activeCount || (scope !== 'all' ? 1 : 0)}
                    </span>
                )}
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.1 }}
                        className="absolute top-full left-0 z-50 mt-2 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden"
                    >
                        {/* Header */}
                        <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between">
                            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Task Controls</span>
                            {(hasActiveFilters) && (
                                <button
                                    onClick={() => {
                                        setScope?.('all');
                                        setBulkMode?.(false);
                                        setReorderMode?.(false);
                                        setViewMode('board');
                                    }}
                                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
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
                                                ? "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/20 dark:border-indigo-800 dark:text-indigo-300"
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
                                                ? "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/20 dark:border-indigo-800 dark:text-indigo-300"
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
                                        {scope === 'all' && <Check className="w-4 h-4 text-indigo-600" />}
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
                                        {scope === 'backlog' && <Check className="w-4 h-4 text-indigo-600" />}
                                    </button>
                                </div>
                            </div>

                            {/* Backlog Options - Conditional */}
                            {scope === 'backlog' && (
                                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
                                    <label className="flex items-center justify-between cursor-pointer group">
                                        <span className="text-sm text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 transition-colors">Enable manual reorder</span>
                                        <input
                                            type="checkbox"
                                            checked={isReorderMode}
                                            onChange={(e) => setReorderMode?.(e.target.checked)}
                                            className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                    </label>
                                </div>
                            )}

                            {/* Bulk Actions */}
                            <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Bulk Actions</label>
                                <button
                                    onClick={() => setBulkMode?.(!isBulkMode)}
                                    className={cn(
                                        "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium border transition-colors",
                                        isBulkMode
                                            ? "bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/20 dark:border-purple-800 dark:text-purple-300"
                                            : "border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                    )}
                                >
                                    <span className="flex items-center gap-2">
                                        <CheckSquare className="w-4 h-4" />
                                        {isBulkMode ? "Bulk Mode Active" : "Enable Bulk Mode"}
                                    </span>
                                    {isBulkMode && (
                                        <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full dark:bg-purple-800 dark:text-purple-200">
                                            On
                                        </span>
                                    )}
                                </button>
                                {isBulkMode && (
                                    <p className="text-xs text-zinc-500 px-1">
                                        {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
                                    </p>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
