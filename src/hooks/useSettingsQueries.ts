"use client";

import { useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { NotificationPreferences, SecurityData, PrivacySettings } from "@/lib/types/settingsTypes";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";

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

const DEFAULT_SECURITY_DATA: SecurityData = {
    mfaFactors: [],
    passkeys: [],
    sessions: [],
    loginHistory: [],
};

const SETTINGS_VIEWER_TTL_MS = 30_000;
type SettingsViewerResolverState = {
    cachedUserId: string | null;
    expiresAt: number;
    inFlight: Promise<string | null> | null;
};

function createSettingsViewerResolverState(): SettingsViewerResolverState {
    return {
        cachedUserId: null,
        expiresAt: 0,
        inFlight: null,
    };
}

async function resolveSettingsViewerId(
    supabase: ReturnType<typeof createSupabaseBrowserClient>,
    state: SettingsViewerResolverState,
): Promise<string | null> {
    const now = Date.now();
    if (state.cachedUserId !== null && state.expiresAt > now) {
        return state.cachedUserId;
    }

    if (state.inFlight) {
        return state.inFlight;
    }

    state.inFlight = supabase.auth
        .getUser()
        .then((authResult: { data: { user: { id: string } | null }; error: Error | null }) => {
            const { data, error } = authResult;
            if (error) {
                state.cachedUserId = null;
                state.expiresAt = 0;
                throw error;
            }

            const userId = data.user?.id ?? null;
            if (userId !== null) {
                state.cachedUserId = userId;
                state.expiresAt = Date.now() + SETTINGS_VIEWER_TTL_MS;
            } else {
                // Do not cache null viewer IDs so retries after auth changes work immediately.
                state.cachedUserId = null;
                state.expiresAt = 0;
            }
            return userId;
        })
        .finally(() => {
            state.inFlight = null;
        });

    return state.inFlight;
}

// Notification preferences
export function useNotificationPreferences() {
    const supabase = createSupabaseBrowserClient();
    const viewerResolverStateRef = useRef<SettingsViewerResolverState>(createSettingsViewerResolverState());

    return useQuery({
        queryKey: queryKeys.settings.notifications(),
        queryFn: async (): Promise<NotificationPreferences> => {
            const userId = await resolveSettingsViewerId(supabase, viewerResolverStateRef.current);
            if (!userId) throw new Error("Not authenticated");

            const { data, error } = await supabase
                .from("profiles")
                .select("notification_preferences")
                .eq("id", userId)
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
    const viewerResolverStateRef = useRef<SettingsViewerResolverState>(createSettingsViewerResolverState());
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (preferences: NotificationPreferences) => {
            const userId = await resolveSettingsViewerId(supabase, viewerResolverStateRef.current);
            if (!userId) throw new Error("Not authenticated");

            const { error } = await supabase
                .from("profiles")
                .update({ notification_preferences: preferences })
                .eq("id", userId);

            if (error) throw error;
            return preferences;
        },
        onMutate: async (newPrefs) => {
            // Optimistic update
            await queryClient.cancelQueries({ queryKey: queryKeys.settings.notifications() });
            const previous = queryClient.getQueryData(queryKeys.settings.notifications());
            queryClient.setQueryData(queryKeys.settings.notifications(), newPrefs);
            return { previous };
        },
        onError: (err, newPrefs, context) => {
            if (context?.previous) {
                queryClient.setQueryData(queryKeys.settings.notifications(), context.previous);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.settings.notifications() });
        },
    });
}

// Security data
export function useSecurityData(options?: { hardeningEnabled?: boolean }) {
    const hardeningEnabled = options?.hardeningEnabled ?? false;
    return useQuery({
        queryKey: queryKeys.settings.security(),
        queryFn: async (): Promise<SecurityData> => {
            const res = await fetch("/api/v1/security");
            const contentType = res.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
                throw new Error(`Security endpoint returned non-JSON response (${res.status})`);
            }

            const json = await res.json();
            const message =
                (typeof json?.error === "string" && json.error) ||
                (typeof json?.message === "string" && json.message) ||
                `Failed to load security data (${res.status})`;
            if (!res.ok || json?.success === false) {
                throw new Error(message);
            }

            return json?.data || DEFAULT_SECURITY_DATA;
        },
        retry: 1,
        staleTime: hardeningEnabled ? 60_000 : 0,
        gcTime: hardeningEnabled ? 5 * 60_000 : undefined,
    });
}

export function useChangePassword() {
    return useMutation({
        mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
            const toFailure = (message: string) => ({ success: false as const, message });
            try {
                const res = await fetch("/api/v1/auth/change-password", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ currentPassword, newPassword }),
                });

                const contentType = res.headers.get("content-type") || "";
                const isJson = contentType.includes("application/json");

                if (!res.ok) {
                    if (isJson) {
                        try {
                            const errorJson = await res.json();
                            const message = errorJson?.message || errorJson?.error;
                            if (typeof message === "string" && message.trim().length > 0) {
                                return toFailure(message);
                            }
                        } catch {
                            // Fall through to generic error
                        }
                    }
                    const fallback = res.statusText
                        ? `Password change failed (${res.status}: ${res.statusText})`
                        : `Password change failed (${res.status})`;
                    return toFailure(fallback);
                }

                if (!isJson) {
                    return { success: true as const };
                }

                const json = await res.json();
                if (json?.success === false) {
                    const message =
                        typeof json?.message === "string" && json.message
                            ? json.message
                            : "Password change failed";
                    return toFailure(message);
                }
                const success = typeof json?.success === "boolean" ? json.success : true;
                const message = typeof json?.message === "string" ? json.message : undefined;
                return { success, message, data: json?.data };
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unable to change password. Please try again.";
                return toFailure(message);
            }
        },
    });
}

// Privacy settings
export function usePrivacySettings() {
    const supabase = createSupabaseBrowserClient();
    const viewerResolverStateRef = useRef<SettingsViewerResolverState>(createSettingsViewerResolverState());

    return useQuery({
        queryKey: queryKeys.settings.privacy(),
        queryFn: async (): Promise<PrivacySettings> => {
            const userId = await resolveSettingsViewerId(supabase, viewerResolverStateRef.current);
            if (!userId) throw new Error("Not authenticated");

            const { data, error } = await supabase
                .from("profiles")
                .select("is_private, connection_privacy")
                .eq("id", userId)
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
    const supabase = createSupabaseBrowserClient();
    const viewerResolverStateRef = useRef<SettingsViewerResolverState>(createSettingsViewerResolverState());

    const prefetchNotifications = () => {
        queryClient.prefetchQuery({
            queryKey: queryKeys.settings.notifications(),
            queryFn: async () => {
                const userId = await resolveSettingsViewerId(supabase, viewerResolverStateRef.current);
                if (!userId) return DEFAULT_NOTIFICATION_PREFERENCES;

                const { data, error } = await supabase
                    .from("profiles")
                    .select("notification_preferences")
                    .eq("id", userId)
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
            queryKey: queryKeys.settings.security(),
            queryFn: async () => {
                const res = await fetch("/api/v1/security");
                const contentType = res.headers.get("content-type") || "";
                if (!contentType.includes("application/json")) {
                    throw new Error(`Security endpoint returned non-JSON response (${res.status})`);
                }
                const json = await res.json();
                if (!res.ok || json?.success === false) {
                    const message =
                        (typeof json?.error === "string" && json.error) ||
                        (typeof json?.message === "string" && json.message) ||
                        `Failed to load security data (${res.status})`;
                    throw new Error(message);
                }
                return json.data || DEFAULT_SECURITY_DATA;
            },
            retry: 0,
        });
    };

    const prefetchPrivacy = () => {
        queryClient.prefetchQuery({
            queryKey: queryKeys.settings.privacy(),
            queryFn: async () => {
                const userId = await resolveSettingsViewerId(supabase, viewerResolverStateRef.current);
                if (!userId) throw new Error("Not authenticated");

                const { data, error } = await supabase
                    .from("profiles")
                    .select("is_private, connection_privacy")
                    .eq("id", userId)
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
