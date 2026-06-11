"use client";

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { readMessageWorkLinksAction } from "@/app/actions/messaging/linked-work";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import type { MessageLinkedWorkSummary } from "@/lib/messages/linked-work";
import { subscribeActiveResource } from "@/lib/realtime/subscriptions";

const MAX_LINKED_WORK_MESSAGE_IDS = 160;
const linkedWorkQueryPrefix = (conversationId: string) => ["chat-v2", "linked-work", conversationId] as const;

export function useMessageWorkLinks(conversationId: string | null | undefined, messageIds: readonly string[]) {
    const queryClient = useQueryClient();
    const normalizedMessageIds = useMemo(
        () => Array.from(new Set(messageIds.filter(Boolean))).slice(0, MAX_LINKED_WORK_MESSAGE_IDS),
        [messageIds],
    );
    const queryKey = useMemo(
        () => queryKeys.messages.v2.linkedWork(conversationId, normalizedMessageIds),
        [conversationId, normalizedMessageIds],
    );

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
        const channel = subscribeActiveResource({
            supabase,
            resourceType: "message_work_links",
            resourceId: conversationId,
            bindings: [
                {
                    event: "*",
                    table: "message_work_links",
                    filter: `source_conversation_id=eq.${conversationId}`,
                    handler: () => {
                        void queryClient.invalidateQueries({
                            queryKey: linkedWorkQueryPrefix(conversationId),
                            exact: false,
                        });
                    },
                },
            ],
            onStatus: (status) => {
                if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
                    void queryClient.invalidateQueries({
                        queryKey: linkedWorkQueryPrefix(conversationId),
                        exact: false,
                    });
                }
            },
        });

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [conversationId, queryClient]);

    return query;
}
