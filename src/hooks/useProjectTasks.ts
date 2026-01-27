import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

interface Task {
    id: string;
    title: string;
    status: string;
    priority: string;
}

export function useProjectTasks(projectId: string) {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchTasks = async () => {
            try {
                const supabase = createClient();
                const { data, error } = await supabase
                    .from("tasks")
                    .select("id, title, status, priority")
                    .eq("project_id", projectId)
                    .order("created_at", { ascending: false });

                if (error) throw error;
                setTasks(data || []);
            } catch (err) {
                console.error("Error fetching tasks:", err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchTasks();
    }, [projectId]);

    return { tasks, isLoading };
}
