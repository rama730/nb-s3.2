import { useState, useEffect, useRef } from "react";
import { ProjectNode } from "@/lib/db/schema";
import { getTaskAttachments } from "@/app/actions/files";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import { subscribeTaskResource } from "@/lib/realtime/task-resource";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";

export function useTaskAttachments(taskId: string) {
    const [attachments, setAttachments] = useState<ProjectNode[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { isConnected } = useRealtime();
    const resourceConnectedRef = useRef(false);

    useEffect(() => {
        let isMounted = true;
        resourceConnectedRef.current = false;

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

        const polling = createVisibilityAwareInterval(() => {
            void fetchAttachments();
        }, 30000);

        const syncPolling = () => {
            if (isConnected && resourceConnectedRef.current) {
                polling.stop();
                return;
            }
            polling.start();
        };

        syncPolling();

        const unsubscribe = subscribeTaskResource({
            taskId,
            onEvent: (event) => {
                if (event.kind === "attachment_link") {
                    void fetchAttachments();
                }
            },
            onStatus: (status) => {
                resourceConnectedRef.current = status === "SUBSCRIBED";
                syncPolling();
            },
        });

        return () => {
            isMounted = false;
            resourceConnectedRef.current = false;
            polling();
            unsubscribe();
        };
    }, [isConnected, taskId]);

    return { attachments, isLoading };
}
