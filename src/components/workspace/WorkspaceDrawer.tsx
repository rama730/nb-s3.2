"use client";

import React, { useEffect, useState, useRef } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { X, Briefcase, Loader2 } from "lucide-react";
import { useUIStore } from "@/lib/stores/ui-store";
import { useAuth } from "@/hooks/useAuth";
import { getWorkspaceTaskInfoAction } from "@/app/actions/workspace";
import { toast } from "sonner";
import dynamic from "next/dynamic";

// Consolidated Unified Overview Tab
import WorkspaceOverviewTab from "./WorkspaceOverviewTab";

// Dynamic loading of Workspace Task Details View to keep initial bundle size minimal
const WorkspaceTaskDetailView = dynamic(() => import("./WorkspaceTaskDetailView"), {
    ssr: false,
    loading: () => (
        <div className="flex flex-col items-center justify-center h-full py-20 space-y-3 bg-white dark:bg-zinc-950">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">Loading task details...</span>
        </div>
    )
});

export default function WorkspaceDrawer() {
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const { user } = useAuth();

    const isWorkspaceOpen = useUIStore((s) => s.isWorkspaceOpen);
    const workspaceTaskId = useUIStore((s) => s.workspaceTaskId);

    const setWorkspaceOpen = useUIStore((s) => s.setWorkspaceOpen);
    const setWorkspaceTaskId = useUIStore((s) => s.setWorkspaceTaskId);

    const [selectedTask, setSelectedTask] = useState<any | null>(null);
    const [loadingTask, setLoadingTask] = useState(false);
    const firstRenderRef = useRef(true);

    // Escape key listener to close drawer or go back
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (workspaceTaskId) {
                    setWorkspaceTaskId(null);
                } else if (isWorkspaceOpen) {
                    setWorkspaceOpen(false);
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isWorkspaceOpen, workspaceTaskId, setWorkspaceOpen, setWorkspaceTaskId]);

    // Handle deep-linking parameters from URL on mount
    useEffect(() => {
        const type = searchParams?.get("drawerType");
        const id = searchParams?.get("drawerId");

        if (type === "workspace") {
            setWorkspaceOpen(true);
            if (id) {
                setWorkspaceTaskId(id);
            }
        }
    }, [searchParams, setWorkspaceOpen, setWorkspaceTaskId]);

    // Shallow Sync UI State back to URL
    useEffect(() => {
        if (!searchParams) return;
        
        // Skip run on first mount to let mount sync handler
        if (firstRenderRef.current) {
            firstRenderRef.current = false;
            return;
        }

        const params = new URLSearchParams(searchParams.toString());
        
        if (isWorkspaceOpen) {
            params.set("drawerType", "workspace");
            if (workspaceTaskId) {
                params.set("drawerId", workspaceTaskId);
            } else {
                params.delete("drawerId");
            }
            // Keep drawerTab removed or clean to simplify
            params.delete("drawerTab");
        } else {
            if (params.get("drawerType") === "workspace") {
                params.delete("drawerType");
                params.delete("drawerId");
                params.delete("drawerTab");
            }
        }

        const newQuery = params.toString();
        const currentQuery = searchParams.toString();
        if (newQuery === currentQuery) return;

        const nextUrl = newQuery ? `${pathname}?${newQuery}` : pathname;
        window.history.replaceState(null, "", nextUrl);
    }, [isWorkspaceOpen, workspaceTaskId, pathname, searchParams]);

    // Resolve task details on deep-linking reload
    useEffect(() => {
        if (workspaceTaskId) {
            if (selectedTask?.id === workspaceTaskId) return;

            setLoadingTask(true);
            getWorkspaceTaskInfoAction(workspaceTaskId).then((res) => {
                if (res.success && res.task) {
                    setSelectedTask(res.task);
                } else {
                    toast.error(res.error || "Failed to retrieve task details");
                    setWorkspaceTaskId(null);
                }
                setLoadingTask(false);
            }).catch((e) => {
                toast.error("Failed to retrieve task details");
                setWorkspaceTaskId(null);
                setLoadingTask(false);
            });
        } else {
            setSelectedTask(null);
        }
    }, [workspaceTaskId, setWorkspaceTaskId, selectedTask?.id]);

    if (!user) return null;

    const showTaskDetails = workspaceTaskId && (selectedTask || loadingTask);

    return (
        <>
            <AnimatePresence>
                {isWorkspaceOpen && (
                    <>
                        {/* Backdrop overlay */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            onClick={() => setWorkspaceOpen(false)}
                            className="fixed inset-0 top-[var(--ui-topnav-height,56px)] z-[200] bg-zinc-950/35 backdrop-blur-[2px]"
                            data-testid="workspace-drawer-backdrop"
                        />

                        {/* Slide-over panel */}
                        <motion.div
                            initial={{ x: "100%" }}
                            animate={{ x: 0 }}
                            exit={{ x: "100%" }}
                            transition={{ type: "spring", damping: 26, stiffness: 220 }}
                            className="fixed right-0 top-[var(--ui-topnav-height,56px)] z-[201] flex h-[calc(100vh-var(--ui-topnav-height,56px))] w-full max-w-[92%] sm:max-w-xl md:max-w-2xl flex-col border-l border-zinc-200 bg-white shadow-[-20px_0_50px_-10px_rgba(0,0,0,0.15)] dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-[-20px_0_50px_-10px_rgba(0,0,0,0.5)]"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="workspace-drawer-title"
                        >
                            {/* Drawer Header */}
                            <div className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800/80 px-6 py-4 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Briefcase className="w-5 h-5 text-blue-500" />
                                    <h2 id="workspace-drawer-title" className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                                        Personal Workspace
                                    </h2>
                                </div>
                                <button
                                    onClick={() => setWorkspaceOpen(false)}
                                    className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                                    aria-label="Close workspace drawer"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Main Viewport Container */}
                            <div className="flex-1 overflow-y-auto bg-zinc-50/20 dark:bg-zinc-950/20 flex flex-col min-h-0 relative">
                                <AnimatePresence mode="wait">
                                    {!showTaskDetails ? (
                                        <motion.div
                                            key="overview"
                                            initial={{ opacity: 0, x: -15 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: 15 }}
                                            transition={{ duration: 0.2 }}
                                            className="p-6 flex-1 overflow-y-auto"
                                        >
                                            <WorkspaceOverviewTab />
                                        </motion.div>
                                    ) : (
                                        <motion.div
                                            key="task-details"
                                            initial={{ opacity: 0, x: 15 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -15 }}
                                            transition={{ duration: 0.2 }}
                                            className="flex-1 overflow-y-auto flex flex-col min-h-0 h-full"
                                        >
                                            {loadingTask ? (
                                                <div className="flex flex-col items-center justify-center h-full py-20 space-y-3">
                                                    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                                                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Loading task details...</span>
                                                </div>
                                            ) : (
                                                selectedTask && (
                                                    <WorkspaceTaskDetailView
                                                        task={selectedTask}
                                                        onBack={() => setWorkspaceTaskId(null)}
                                                    />
                                                )
                                            )}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
