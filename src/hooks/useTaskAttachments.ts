import { useState, useEffect } from "react";
import { ProjectNode } from "@/lib/db/schema";
import { getTaskAttachments } from "@/app/actions/files";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import { subscribeTaskResource } from "@/lib/realtime/task-resource";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";

export function useTaskAttachments(taskId: string) {
    const [attachments, setAttachments] = useState<ProjectNode[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { isConnected } = useRealtime();
    const [resourceConnected, setResourceConnected] = useState(false);

    useEffect(() => {
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

        const unsubscribe = subscribeTaskResource({
            taskId,
            onEvent: (event) => {
                if (event.kind === "attachment_link") {
                    void fetchAttachments();
                }
            },
            onStatus: (status) => {
                setResourceConnected(status === "SUBSCRIBED");
            },
        });

        const cleanup = isConnected && resourceConnected
            ? () => undefined
            : createVisibilityAwareInterval(() => {
                void fetchAttachments();
            }, 30000);

        return () => {
            isMounted = false;
            cleanup();
            unsubscribe();
        };
    }, [isConnected, resourceConnected, taskId]);

    return { attachments, isLoading };
}
