import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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

    const refresh = async () => {
        try {
            const supabase = createSupabaseBrowserClient();
            const { data: { user } } = await supabase.auth.getUser();

            if (!user?.id) return;

            // Count pending incoming connection requests
            const { count: connCount } = await supabase
                .from("connections")
                .select("id", { count: "exact", head: true })
                .eq("connected_user_id", user.id)
                .eq("status", "pending");

            // Count pending project invites
            const { count: invCount } = await supabase
                .from("project_invitations")
                .select("id", { count: "exact", head: true })
                .eq("invitee_id", user.id)
                .eq("status", "pending");

            setPendingConnections(connCount || 0);
            setPendingInvites(invCount || 0);
        } catch (error) {
            console.error("Error fetching notification counts:", error);
        }
    };

    useEffect(() => {
        refresh();
    }, []);

    return {
        totalPending: pendingConnections + pendingInvites,
        pendingConnections,
        pendingInvites,
        refresh,
    };
}
