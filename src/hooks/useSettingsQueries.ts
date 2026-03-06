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

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
    email: true,
    push: true,
    projects: true,
    messages: true,
    mentions: true,
};

const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
    is_private: false,
    connection_privacy: "public",
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
                .maybeSingle();

            if (error) {
                // Keep settings screens usable even if a profile row/column is unavailable.
                console.warn("[settings] notification preferences lookup failed", error);
                return DEFAULT_NOTIFICATION_PREFERENCES;
            }

            return data?.notification_preferences || DEFAULT_NOTIFICATION_PREFERENCES;
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
            const defaults: SecurityData = {
                mfaFactors: [],
                passkeys: [],
                sessions: [],
                loginHistory: [],
            };
            try {
                const res = await fetch("/api/v1/security");
                if (!res.ok) return defaults;
                const contentType = res.headers.get("content-type") || "";
                if (!contentType.includes("application/json")) return defaults;
                const json = await res.json();
                return json.data || defaults;
            } catch {
                return defaults;
            }
        },
    });
}

export function useChangePassword() {
    return useMutation({
        mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
            try {
                const res = await fetch("/api/v1/auth/change-password", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ currentPassword, newPassword }),
                });

                if (!res.ok) {
                    return { success: false, message: "Password change is not available yet" };
                }
                const contentType = res.headers.get("content-type") || "";
                if (!contentType.includes("application/json")) {
                    return { success: false, message: "Password change is not available yet" };
                }
                const json = await res.json();
                return json;
            } catch {
                return { success: false, message: "Password change is not available yet" };
            }
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
                .maybeSingle();

            if (error) {
                console.warn("[settings] privacy settings lookup failed", error);
                return DEFAULT_PRIVACY_SETTINGS;
            }

            return {
                is_private: data?.is_private || DEFAULT_PRIVACY_SETTINGS.is_private,
                connection_privacy: data?.connection_privacy || DEFAULT_PRIVACY_SETTINGS.connection_privacy,
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

                const { data, error } = await supabase
                    .from("profiles")
                    .select("notification_preferences")
                    .eq("id", user.id)
                    .maybeSingle();

                if (error) {
                    console.warn("[settings] notification preferences prefetch failed", error);
                    return DEFAULT_NOTIFICATION_PREFERENCES;
                }

                return data?.notification_preferences || DEFAULT_NOTIFICATION_PREFERENCES;
            },
        });
    };

    const prefetchSecurity = () => {
        queryClient.prefetchQuery({
            queryKey: SETTINGS_KEYS.security,
            queryFn: async () => {
                const defaults = { mfaFactors: [], passkeys: [], sessions: [], loginHistory: [] };
                try {
                    const res = await fetch("/api/v1/security");
                    if (!res.ok) return defaults;
                    const contentType = res.headers.get("content-type") || "";
                    if (!contentType.includes("application/json")) return defaults;
                    const json = await res.json();
                    return json.data || defaults;
                } catch {
                    return defaults;
                }
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

                const { data, error } = await supabase
                    .from("profiles")
                    .select("is_private, connection_privacy")
                    .eq("id", user.id)
                    .maybeSingle();

                if (error) {
                    console.warn("[settings] privacy prefetch failed", error);
                    return DEFAULT_PRIVACY_SETTINGS;
                }

                return {
                    is_private: data?.is_private || DEFAULT_PRIVACY_SETTINGS.is_private,
                    connection_privacy: data?.connection_privacy || DEFAULT_PRIVACY_SETTINGS.connection_privacy,
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
