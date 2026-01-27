"use client";

import { useState, useEffect, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui-custom/Toast";

export interface Habit {
    id: string;
    title: string;
    completed: boolean;
    streak: number;
}

export interface WorkspaceTask {
    id: string;
    title: string;
    project: string;
    projectId: string;
    projectColor: string;
    due?: string;
    status: "todo" | "in_progress" | "done";
    priority: string;
}

export interface InboxItem {
    id: string;
    type: "task" | "mention" | "approval" | "alert" | "info";
    title: string;
    subtitle: string;
    time: string;
    priority?: "high" | "medium" | "low";
    read: boolean;
    data?: any;
}

const HABITS_STORAGE_KEY = "workspace-habits-v1";

export function useWorkspaceData() {
    const supabase = createSupabaseBrowserClient();
    const { user } = useAuth();
    const { showToast } = useToast();

    const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
    const [inbox, setInbox] = useState<InboxItem[]>([]);
    const [habits, setHabits] = useState<Habit[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Load Habits from LocalStorage
    useEffect(() => {
        const savedHabits = localStorage.getItem(HABITS_STORAGE_KEY);
        if (savedHabits) {
            try {
                const parsed = JSON.parse(savedHabits);
                setHabits(parsed);
            } catch (e) {
                console.error("Failed to parse habits", e);
            }
        } else {
            // Default habits
            const defaults: Habit[] = [
                { id: "h1", title: "Morning Standup", completed: false, streak: 0 },
                { id: "h2", title: "Clear Inbox", completed: false, streak: 0 },
                { id: "h3", title: "Plan Tomorrow", completed: false, streak: 0 },
            ];
            setHabits(defaults);
            localStorage.setItem(HABITS_STORAGE_KEY, JSON.stringify(defaults));
        }
    }, []);

    // Fetch Real Data from Supabase
    const fetchData = useCallback(async () => {
        if (!user) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);

        try {
            // 1. Fetch Tasks from project_tasks
            const { data: tasksData, error: tasksError } = await supabase
                .from("project_tasks")
                .select(`
          id, 
          title, 
          status, 
          priority, 
          due_date, 
          project_id,
          projects(title)
        `)
                .eq("assigned_to", user.id)
                .neq("status", "done")
                .order("due_date", { ascending: true })
                .limit(10);

            if (!tasksError && tasksData) {
                const mappedTasks: WorkspaceTask[] = tasksData.map((t: any) => ({
                    id: t.id,
                    title: t.title,
                    project: t.projects?.title || "Unknown Project",
                    projectId: t.project_id,
                    projectColor: "bg-indigo-500",
                    due: t.due_date ? new Date(t.due_date).toLocaleDateString() : undefined,
                    status: t.status,
                    priority: t.priority || "medium"
                }));
                setTasks(mappedTasks);
            }

            // 2. Fetch Notifications (Inbox) - check if table exists
            try {
                const { data: notifsData, error: notifsError } = await supabase
                    .from("notifications")
                    .select("*")
                    .eq("user_id", user.id)
                    .eq("is_read", false)
                    .order("created_at", { ascending: false })
                    .limit(20);

                if (!notifsError && notifsData) {
                    const mappedInbox: InboxItem[] = notifsData.map((n: any) => ({
                        id: n.id,
                        type: mapNotificationType(n.type),
                        title: n.title,
                        subtitle: n.message,
                        time: timeAgo(n.created_at),
                        read: n.is_read,
                        data: n
                    }));
                    setInbox(mappedInbox);
                }
            } catch {
                // Table might not exist, use empty inbox
                setInbox([]);
            }

        } catch (err) {
            console.error("Error fetching workspace data:", err);
        } finally {
            setIsLoading(false);
        }
    }, [user, supabase]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Actions
    const toggleHabit = (id: string) => {
        const newHabits = habits.map(h =>
            h.id === id ? { ...h, completed: !h.completed, streak: h.completed ? h.streak : h.streak + 1 } : h
        );
        setHabits(newHabits);
        localStorage.setItem(HABITS_STORAGE_KEY, JSON.stringify(newHabits));
    };

    const addHabit = (title: string) => {
        const newHabit: Habit = {
            id: Date.now().toString(),
            title,
            completed: false,
            streak: 0
        };
        const newHabits = [...habits, newHabit];
        setHabits(newHabits);
        localStorage.setItem(HABITS_STORAGE_KEY, JSON.stringify(newHabits));
    };

    const removeHabit = (id: string) => {
        const newHabits = habits.filter(h => h.id !== id);
        setHabits(newHabits);
        localStorage.setItem(HABITS_STORAGE_KEY, JSON.stringify(newHabits));
    };

    const startTask = async (id: string) => {
        const task = tasks.find((t) => t.id === id);
        if (!task || task.status !== "todo") return;

        // Optimistic update
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: "in_progress" as const } : t)));

        try {
            const { error } = await supabase
                .from("project_tasks")
                .update({ status: "in_progress" })
                .eq("id", id);

            if (error) throw error;
            showToast(`Started "${task.title}".`, "info");
        } catch (error) {
            // Revert on error
            setTasks((prev) => prev.map((t) => (t.id === id ? task : t)));
            showToast("Failed to start task.", "error");
        }
    };

    const completeTask = async (id: string) => {
        const task = tasks.find((t) => t.id === id);
        if (!task) return;

        const prevStatus = task.status;

        // Optimistic update - remove from list
        setTasks((prev) => prev.filter((t) => t.id !== id));

        try {
            const { error } = await supabase
                .from("project_tasks")
                .update({ status: "done" })
                .eq("id", id);

            if (error) throw error;
            showToast(`Marked "${task.title}" done.`, "success");
        } catch (error) {
            // Revert on error
            setTasks((prev) => [task, ...prev]);
            showToast("Failed to complete task.", "error");
        }
    };

    const markNotificationRead = async (id: string) => {
        setInbox(prev => prev.filter(n => n.id !== id));
        try {
            await supabase.from("notifications").update({ is_read: true }).eq("id", id);
        } catch {
            // Ignore if table doesn't exist
        }
    };

    return {
        tasks,
        inbox,
        habits,
        isLoading,
        toggleHabit,
        addHabit,
        removeHabit,
        startTask,
        completeTask,
        markNotificationRead,
        refresh: fetchData
    };
}

// Helpers
function mapNotificationType(type: string): InboxItem["type"] {
    if (type?.includes("mention")) return "mention";
    if (type?.includes("task")) return "task";
    if (type?.includes("alert") || type?.includes("error")) return "alert";
    return "info";
}

function timeAgo(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
