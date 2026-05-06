"use client";

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { readMessageWorkLinksAction } from "@/app/actions/messaging/linked-work";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import type { MessageLinkedWorkSummary } from "@/lib/messages/linked-work";

export function useMessageWorkLinks(conversationId: string | null | undefined, messageIds: readonly string[]) {
    const queryClient = useQueryClient();
    const normalizedMessageIds = useMemo(
        () => Array.from(new Set(messageIds.filter(Boolean))).slice(0, 120),
        [messageIds],
    );
    const queryKey = queryKeys.messages.v2.linkedWork(conversationId, normalizedMessageIds);

    const query = useQuery({
        queryKey,
        enabled: Boolean(conversationId) && normalizedMessageIds.length > 0,
        staleTime: 30_000,
        queryFn: async () => {
            if (!conversationId) return {} as Record<string, MessageLinkedWorkSummary[]>;
            const result = await readMessageWorkLinksAction(conversationId, normalizedMessageIds);
            if (!result.success) throw new Error(result.error || "Failed to load linked work");
            return result.linksByMessageId;
        },
    });

    useEffect(() => {
        if (!conversationId) return;
        const supabase = createClient();
        const channel = supabase
            .channel(`message-work-links:${conversationId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "message_work_links",
                    filter: `source_conversation_id=eq.${conversationId}`,
                },
                () => {
                    void queryClient.invalidateQueries({
                        queryKey: ["chat-v2", "linked-work", conversationId],
                        exact: false,
                    });
                },
            )
            .subscribe((status: string) => {
                if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
                    void queryClient.invalidateQueries({ queryKey, exact: true });
                }
            });

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [conversationId, queryClient, queryKey]);

    return query;
}
