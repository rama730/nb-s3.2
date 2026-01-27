"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";

// Basic useAuth wrapper compatible with existing use-auth
import { useAuth as useExistingAuth } from "@/lib/hooks/use-auth";

export function useAuth() {
    const auth = useExistingAuth();
    return { ...auth, isSignedIn: auth.isAuthenticated };
}

export function useProfile(userId: string | null) {
    const [profile, setProfile] = useState<any | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const supabase = createClient();

    useEffect(() => {
        async function fetchProfile() {
            if (!userId) {
                setProfile(null);
                setIsLoading(false);
                return;
            }
            try {
                const { data, error } = await supabase
                    .from("profiles")
                    .select("*")
                    .eq("id", userId)
                    .single();
                if (data) {
                    setProfile(data);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setIsLoading(false);
            }
        }
        fetchProfile();
    }, [userId]);

    return { profile, isLoading };
}

// Mocks for other requested hooks
export function useNotifications() {
    return { unreadCount: 0 };
}

export function useMessageNotifications() {
    return { hasUnread: false };
}

export function usePeopleNotifications() {
    return { totalPending: 0 };
}

export function useWorkspace() {
    // Try to use real WorkspaceContext if available
    try {
        const { useWorkspace: useRealWorkspace } = require("@/components/workspace-v2/WorkspaceContext");
        return useRealWorkspace();
    } catch {
        // Fallback mock if context not available
        return { isOpen: false, setOpen: () => { }, setExpanded: () => { } };
    }
}

// Hub Mocks
export const hubKeys = {
    list: (type: string, filters: any) => ['hub', type, filters]
}

export const PROJECT_STATUS = { ALL: 'ALL' }
export const PROJECT_TYPE = { ALL: 'ALL' }
export const SORT_OPTIONS = { NEWEST: 'NEWEST' }

export const fetchHubProjects = async () => ({ pages: [] })

// Logger Mock
export const logger = {
    error: (msg: string, meta?: any) => console.error(msg, meta),
    info: (msg: string, meta?: any) => console.log(msg, meta),
}
