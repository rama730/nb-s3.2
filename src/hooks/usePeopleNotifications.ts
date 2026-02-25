import { useState, useEffect, useCallback, useMemo } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks/use-auth";

interface UsePeopleNotificationsReturn {
    totalPending: number;
    pendingConnections: number;
    pendingInvites: number;
    refresh: () => Promise<void>;
}

/**
 * Hook to get pending notification counts for the People section.
 */
export function usePeopleNotifications(): UsePeopleNotificationsReturn {
    const [pendingConnections, setPendingConnections] = useState(0);
    const [pendingInvites, setPendingInvites] = useState(0);
    const { user } = useAuth();
    const userId = user?.id;
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);

    const refresh = useCallback(async () => {
        try {
            if (!userId) {
                setPendingConnections(0);
                setPendingInvites(0);
                return;
            }

            // Count pending incoming connection requests
            const { count: connCount } = await supabase
                .from("connections")
                .select("id", { count: "exact", head: true })
                .eq("addressee_id", userId)
                .eq("status", "pending");

            setPendingConnections(connCount || 0);
            setPendingInvites(0);
        } catch (error) {
            console.error("Error fetching notification counts:", error);
        }
    }, [supabase, userId]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        if (!userId) return;
        const channel = supabase
            .channel(`people-notifications-${userId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "connections",
                    filter: `addressee_id=eq.${userId}`,
                },
                () => {
                    void refresh();
                }
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [supabase, userId, refresh]);

    return {
        totalPending: pendingConnections + pendingInvites,
        pendingConnections,
        pendingInvites,
        refresh,
    };
}
