import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { ProjectNode } from "@/lib/db/schema";
import { getTaskAttachments } from "@/app/actions/files";

export function useTaskAttachments(taskId: string) {
    const [attachments, setAttachments] = useState<ProjectNode[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const supabase = createClient();
        let isMounted = true;

        const fetchAttachments = async () => {
            try {
                const nodes = await getTaskAttachments(taskId);
                if (isMounted && nodes) {
                    setAttachments(nodes as ProjectNode[]);
                }
            } catch (error) {
                console.error("Error fetching attachments:", error);
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        fetchAttachments();

        // Subscribe to changes in task_node_links
        // When a link is added/removed, re-fetch the nodes
        const channel = supabase
            .channel(`task_attachments:${taskId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "task_node_links",
                    filter: `task_id=eq.${taskId}`
                },
                () => {
                    // Refresh on any change
                    fetchAttachments();
                }
            )
            .subscribe();

        return () => {
            isMounted = false;
            supabase.removeChannel(channel);
        };
    }, [taskId]);

    return { attachments, isLoading };
}
