"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, Loader2 } from "lucide-react";

type Props = {
    taskId: string;
    onClose: () => void;
};

interface Task {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_date: string | null;
    project_id: string;
    assigned_to: string | null;
    created_by: string | null;
    created_at: string;
    projects?: { title: string } | null;
}

export default function TaskDetailView({ taskId, onClose }: Props) {
    const supabase = createSupabaseBrowserClient();
    const { user } = useAuth();

    const [task, setTask] = useState<Task | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data: t, error: taskErr } = await supabase
                .from("project_tasks")
                .select(`
          *,
          projects(title)
        `)
                .eq("id", taskId)
                .single();

            if (taskErr || !t) throw taskErr || new Error("Task not found");
            setTask(t as Task);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Failed to load task";
            setError(msg);
            setTask(null);
        } finally {
            setLoading(false);
        }
    }, [supabase, taskId]);

    useEffect(() => {
        void load();
    }, [load]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center p-6">
                <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading task…
                </div>
            </div>
        );
    }

    if (error || !task) {
        return (
            <div className="h-full p-6">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Couldn't open task</div>
                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{error || "Task not available."}</div>
                    <div className="mt-3 flex gap-2">
                        <button
                            type="button"
                            onClick={load}
                            className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                        >
                            Retry
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold"
                        >
                            Back
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const statusColors: Record<string, string> = {
        todo: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
        in_progress: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
        done: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
    };

    const priorityColors: Record<string, string> = {
        urgent: "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300",
        high: "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300",
        medium: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
        low: "bg-zinc-50 text-zinc-600 dark:bg-zinc-900/30 dark:text-zinc-300",
    };

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
                <button
                    onClick={onClose}
                    className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                    <ArrowLeft size={18} className="text-zinc-500" />
                </button>
                <div className="flex-1 min-w-0">
                    <div className="text-xs text-zinc-500 truncate">
                        {task.projects?.title || "Project"}
                    </div>
                    <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {task.title}
                    </h3>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Status & Priority */}
                <div className="flex flex-wrap gap-2">
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${statusColors[task.status] || statusColors.todo}`}>
                        {task.status.replace("_", " ").toUpperCase()}
                    </span>
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${priorityColors[task.priority] || priorityColors.medium}`}>
                        {(task.priority || "medium").toUpperCase()}
                    </span>
                </div>

                {/* Due Date */}
                {task.due_date && (
                    <div className="text-sm">
                        <span className="text-zinc-500">Due: </span>
                        <span className="text-zinc-800 dark:text-zinc-200 font-medium">
                            {new Date(task.due_date).toLocaleDateString()}
                        </span>
                    </div>
                )}

                {/* Description */}
                <div>
                    <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">
                        Description
                    </h4>
                    <div className="bg-zinc-50 dark:bg-zinc-900 rounded-xl p-4 text-sm text-zinc-700 dark:text-zinc-300">
                        {task.description || "No description provided."}
                    </div>
                </div>

                {/* Created */}
                <div className="text-xs text-zinc-400">
                    Created {new Date(task.created_at).toLocaleDateString()}
                </div>
            </div>
        </div>
    );
}
