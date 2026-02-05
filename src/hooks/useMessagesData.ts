"use client";

import { useQuery } from "@tanstack/react-query";
import { getConversations } from "@/app/actions/messaging";
import { getProfileBasic } from "@/app/actions/profile"; // Will create/verify this

export const MESSAGES_KEYS = {
    conversations: ['chat', 'conversations'],
    targetUser: (userId: string) => ['chat', 'targetUser', userId]
};

export function useConversations(initialData?: any[]) {
    return useQuery({
        queryKey: MESSAGES_KEYS.conversations,
        queryFn: async () => {
            const result = await getConversations();
            if (!result.success) throw new Error(result.error);
            return result.conversations || [];
        },
        initialData: initialData,
        // Stale time handled by cache/invalidation mostly, but keep it freshish
        staleTime: 1000 * 60,
    });
}

export function useTargetUser(userId: string | null) {
    return useQuery({
        queryKey: MESSAGES_KEYS.targetUser(userId || ''),
        queryFn: async () => {
            if (!userId) return null;
            const result = await getProfileBasic(userId);
            return result;
        },
        enabled: !!userId,
        staleTime: 1000 * 60 * 5, // 5 min
    });
}
