"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { NotificationPreferences, SecurityData, PrivacySettings } from "@/lib/types/settingsTypes";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Query keys
const SETTINGS_KEYS = {
    notifications: ["settings", "notifications"] as const,
    security: ["settings", "security"] as const,
    privacy: ["settings", "privacy"] as const,
};

// Notification preferences
export function useNotificationPreferences() {
    const supabase = createSupabaseBrowserClient();

    return useQuery({
        queryKey: SETTINGS_KEYS.notifications,
        queryFn: async (): Promise<NotificationPreferences> => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            const { data, error } = await supabase
                .from("profiles")
                .select("notification_preferences")
                .eq("id", user.id)
                .single();

            if (error) throw error;

            // Default preferences if not set
            const defaultPrefs: NotificationPreferences = {
                email: true,
                push: true,
                projects: true,
                messages: true,
                mentions: true,
            };

            return data?.notification_preferences || defaultPrefs;
        },
    });
}

export function useUpdateNotificationPreferences() {
    const supabase = createSupabaseBrowserClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (preferences: NotificationPreferences) => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            const { error } = await supabase
                .from("profiles")
                .update({ notification_preferences: preferences })
                .eq("id", user.id);

            if (error) throw error;
            return preferences;
        },
        onMutate: async (newPrefs) => {
            // Optimistic update
            await queryClient.cancelQueries({ queryKey: SETTINGS_KEYS.notifications });
            const previous = queryClient.getQueryData(SETTINGS_KEYS.notifications);
            queryClient.setQueryData(SETTINGS_KEYS.notifications, newPrefs);
            return { previous };
        },
        onError: (err, newPrefs, context) => {
            if (context?.previous) {
                queryClient.setQueryData(SETTINGS_KEYS.notifications, context.previous);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: SETTINGS_KEYS.notifications });
        },
    });
}

// Security data
export function useSecurityData() {
    return useQuery({
        queryKey: SETTINGS_KEYS.security,
        queryFn: async (): Promise<SecurityData> => {
            // Fetch security data from API
            const res = await fetch("/api/v1/security");
            if (!res.ok) throw new Error("Failed to fetch security data");
            const json = await res.json();
            return json.data || {
                mfaFactors: [],
                passkeys: [],
                sessions: [],
                loginHistory: [],
            };
        },
    });
}

export function useChangePassword() {
    return useMutation({
        mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
            const res = await fetch("/api/v1/auth/change-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentPassword, newPassword }),
            });

            const json = await res.json();
            return json;
        },
    });
}

// Privacy settings
export function usePrivacySettings() {
    const supabase = createSupabaseBrowserClient();

    return useQuery({
        queryKey: SETTINGS_KEYS.privacy,
        queryFn: async (): Promise<PrivacySettings> => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            const { data, error } = await supabase
                .from("profiles")
                .select("is_private, connection_privacy")
                .eq("id", user.id)
                .single();

            if (error) throw error;

            return {
                is_private: data?.is_private || false,
                connection_privacy: data?.connection_privacy || "public",
            };
        },
    });
}

// Prefetch hooks
export function usePrefetchSettings() {
    const queryClient = useQueryClient();

    const prefetchNotifications = () => {
        queryClient.prefetchQuery({
            queryKey: SETTINGS_KEYS.notifications,
            queryFn: async () => {
                const supabase = createSupabaseBrowserClient();
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return null;

                const { data } = await supabase
                    .from("profiles")
                    .select("notification_preferences")
                    .eq("id", user.id)
                    .single();

                return data?.notification_preferences || {
                    email: true,
                    push: true,
                    projects: true,
                    messages: true,
                    mentions: true,
                };
            },
        });
    };

    const prefetchSecurity = () => {
        queryClient.prefetchQuery({
            queryKey: SETTINGS_KEYS.security,
            queryFn: async () => {
                const res = await fetch("/api/v1/security");
                if (!res.ok) return { mfaFactors: [], passkeys: [], sessions: [], loginHistory: [] };
                const json = await res.json();
                return json.data;
            },
        });
    };

    const prefetchPrivacy = () => {
        queryClient.prefetchQuery({
            queryKey: SETTINGS_KEYS.privacy,
            queryFn: async () => {
                const supabase = createSupabaseBrowserClient();
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return null;

                const { data } = await supabase
                    .from("profiles")
                    .select("is_private, connection_privacy")
                    .eq("id", user.id)
                    .single();

                return {
                    is_private: data?.is_private || false,
                    connection_privacy: data?.connection_privacy || "public",
                };
            },
        });
    };

    return {
        prefetchNotifications,
        prefetchSecurity,
        prefetchPrivacy,
    };
}
