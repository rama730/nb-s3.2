"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readMessageWorkLinksAction } from "@/app/actions/messaging/linked-work";
import { queryKeys } from "@/lib/query-keys";
import type { MessageLinkedWorkSummary } from "@/lib/messages/linked-work";

const RECENT_LINKED_WORK_MESSAGE_COUNT = 5;
const LINKED_WORK_DEFER_MS = 1_000;

export function useMessageWorkLinks(conversationId: string | null | undefined, messageIds: readonly string[]) {
    const [isDeferredQueryReady, setIsDeferredQueryReady] = useState(false);
    const normalizedMessageIds = useMemo(
        () => Array.from(new Set(messageIds.filter(Boolean))).slice(-RECENT_LINKED_WORK_MESSAGE_COUNT),
        [messageIds],
    );
    const queryKey = useMemo(
        () => queryKeys.messages.v2.linkedWork(conversationId, normalizedMessageIds),
        [conversationId, normalizedMessageIds],
    );

    useEffect(() => {
        setIsDeferredQueryReady(false);
        if (!conversationId) return;
        const timer = window.setTimeout(() => setIsDeferredQueryReady(true), LINKED_WORK_DEFER_MS);
        return () => window.clearTimeout(timer);
    }, [conversationId]);

    const query = useQuery({
        queryKey,
        // ponytail: linked work is supplementary context, not part of first
        // paint. Ask for the newest visible rows after the thread settles.
        enabled: isDeferredQueryReady && Boolean(conversationId) && normalizedMessageIds.length > 0,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        queryFn: async () => {
            if (!conversationId) return {} as Record<string, MessageLinkedWorkSummary[]>;
            const result = await readMessageWorkLinksAction(conversationId, normalizedMessageIds);
            if (!result.success) throw new Error(result.error || "Failed to load linked work");
            return result.linksByMessageId;
        },
    });

    return query;
}
