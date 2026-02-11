"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks/use-auth";

const NOTIFICATION_QUERY_KEY = ["notifications", "unread-count"] as const;

export function useNotifications() {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const userId = user?.id || null;

    const query = useQuery({
        queryKey: [...NOTIFICATION_QUERY_KEY, userId],
        queryFn: async () => {
            if (!userId) return 0;
            const supabase = createSupabaseBrowserClient();
            const { count, error } = await supabase
                .from("notifications")
                .select("id", { count: "exact", head: true })
                .eq("user_id", userId)
                .eq("is_read", false);

            if (error) {
                // Keep this resilient in environments where notifications table isn't present.
                if (error.code === "42P01" || error.code === "PGRST205") {
                    return 0;
                }
                throw error;
            }

            return count || 0;
        },
        enabled: !!userId,
        staleTime: 30_000,
        refetchInterval: 60_000,
    });

    useEffect(() => {
        if (!userId) return;

        const supabase = createSupabaseBrowserClient();
        const channel = supabase
            .channel(`notifications-unread-${userId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "notifications",
                    filter: `user_id=eq.${userId}`,
                },
                () => {
                    queryClient.invalidateQueries({ queryKey: [...NOTIFICATION_QUERY_KEY, userId] });
                }
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [userId, queryClient]);

    return {
        unreadCount: query.data || 0,
        isLoading: query.isLoading,
        refresh: query.refetch,
    };
}
