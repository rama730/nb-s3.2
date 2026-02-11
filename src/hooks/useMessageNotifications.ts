"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useChatStore } from "@/stores/chatStore";

export function useMessageNotifications() {
    const { user } = useAuth();
    const totalUnread = useChatStore((state) => state.totalUnread);
    const isInitialized = useChatStore((state) => state.isInitialized);
    const conversationsLoading = useChatStore((state) => state.conversationsLoading);
    const initialize = useChatStore((state) => state.initialize);

    useEffect(() => {
        if (!user?.id) return;
        if (isInitialized || conversationsLoading) return;
        void initialize();
    }, [user?.id, isInitialized, conversationsLoading, initialize]);

    return {
        hasUnread: totalUnread > 0,
        unreadCount: totalUnread,
    };
}
