"use client";

import { useQuery } from "@tanstack/react-query";
import { getConversations, type ConversationWithDetails } from "@/app/actions/messaging";
import { getProfileBasic } from "@/app/actions/profile";

export const MESSAGES_KEYS = {
    conversations: ['chat', 'conversations'],
    targetUser: (userId: string) => ['chat', 'targetUser', userId]
};

type TargetUserProfile = Awaited<ReturnType<typeof getProfileBasic>>;

export function useConversations(initialData?: ConversationWithDetails[]) {
    return useQuery({
        queryKey: MESSAGES_KEYS.conversations,
        queryFn: async (): Promise<ConversationWithDetails[]> => {
            const result = await getConversations();
            if (!result.success) throw new Error(result.error);
            return result.conversations || [];
        },
        initialData,
        staleTime: 1000 * 60,
    });
}

export function useTargetUser(userId: string | null) {
    return useQuery({
        queryKey: MESSAGES_KEYS.targetUser(userId || ''),
        queryFn: async (): Promise<TargetUserProfile> => {
            if (!userId) return null;
            return getProfileBasic(userId);
        },
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
