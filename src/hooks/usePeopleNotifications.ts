import { useState, useEffect, useCallback, useMemo } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks/use-auth";
import { useRealtime } from "@/components/providers/RealtimeProvider";

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
    const { subscribeUserNotifications } = useRealtime();
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
        return subscribeUserNotifications((event) => {
            if (event.kind === "connection") {
                void refresh();
            }
        });
    }, [refresh, subscribeUserNotifications, userId]);

    return {
        totalPending: pendingConnections + pendingInvites,
        pendingConnections,
        pendingInvites,
        refresh,
    };
}
