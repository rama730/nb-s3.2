"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { IntegrationsData, NotificationPreferences, PrivacyData, SecurityData, SecurityStepUpCapabilitiesData } from "@/lib/types/settingsTypes";
import { queryKeys } from "@/lib/query-keys";
import { DEFAULT_NOTIFICATION_PREFERENCES, normalizeNotificationPreferences } from "@/lib/notifications/preferences";
import {
    readNotificationPreferencesAction,
    updateNotificationPreferencesAction,
} from "@/app/actions/notifications";

const DEFAULT_PRIVACY_SETTINGS: PrivacyData = {
    settings: {
        profileVisibility: "public",
        messagePrivacy: "connections",
        connectionPrivacy: "everyone",
        blockedCount: 0,
    },
    blockedAccounts: [],
    overview: {
        profileVisibility: "public",
        messagePrivacy: "connections",
        connectionPrivacy: "everyone",
        blockedCount: 0,
        summary: "Your profile is visible to public. Messages are open to connections only. Connection requests are open to everyone.",
    },
    privacyActivity: [],
    previews: {
        profileVisibility: "Your full profile is open. Messaging and request rules still apply separately.",
        interactionPermissions: "Only connections can message you. Anyone eligible can send a connection request.",
        visitorProfileHref: null,
    },
};

const DEFAULT_SECURITY_DATA: SecurityData = {
    mfaFactors: [],
    sessions: [],
    loginHistory: [],
    password: {
        hasPassword: false,
    },
    recoveryCodes: {
        configured: false,
        remainingCount: 0,
    },
    securityActivity: [],
    assurance: {
        currentLevel: null,
        nextLevel: null,
    },
};

const DEFAULT_INTEGRATIONS_DATA: IntegrationsData = {
    createdWith: null,
    createdWithLabel: "Unknown",
    emailAddress: null,
    emailVerified: false,
    linkedCount: 0,
    additionalLinkedCount: 0,
    summary: "We could not determine how this account was created yet.",
    recommendedNextStep: "Use your current sign-in method to keep this account accessible.",
    infoNote: "You may see only one sign-in method if this account has not been linked to any additional providers.",
    capabilities: {
        canEnableEmailSignIn: false,
        canLinkAdditionalProvider: false,
        canUnlinkGoogle: false,
        canUnlinkGithub: false,
    },
    authConnections: [
        {
            provider: "google",
            label: "Google",
            state: "not_linked",
            detail: "Not linked to this account.",
        },
        {
            provider: "github",
            label: "GitHub",
            state: "not_linked",
            detail: "Not linked to this account.",
        },
        {
            provider: "email",
            label: "Email",
            state: "not_linked",
            detail: "Not linked to this account.",
        },
    ],
    externalServices: [
        {
            id: "github",
            label: "GitHub repository access",
            status: "not_connected",
            summary: "No GitHub repository access is currently in use.",
            detail: "Repository import and sync become available after GitHub is attached to this account and used on a project.",
            usageCount: 0,
        },
    ],
};

// Notification preferences
export function useNotificationPreferences() {
    return useQuery({
        queryKey: queryKeys.settings.notifications(),
        queryFn: async (): Promise<NotificationPreferences> => {
            const result = await readNotificationPreferencesAction();
            if (!result.success) {
                console.warn("[settings] notification preferences lookup failed", result.error);
                return DEFAULT_NOTIFICATION_PREFERENCES;
            }

            return normalizeNotificationPreferences(result.preferences);
        },
    });
}

export function useUpdateNotificationPreferences() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (preferences: NotificationPreferences) => {
            const result = await updateNotificationPreferencesAction(normalizeNotificationPreferences(preferences));
            if (!result.success || !result.preferences) {
                throw new Error(result.error || "Failed to update notification preferences");
            }
            return normalizeNotificationPreferences(result.preferences);
        },
        onMutate: async (newPrefs) => {
            // Optimistic update
            await queryClient.cancelQueries({ queryKey: queryKeys.settings.notifications() });
            const previous = queryClient.getQueryData(queryKeys.settings.notifications());
            queryClient.setQueryData(queryKeys.settings.notifications(), normalizeNotificationPreferences(newPrefs));
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

export function useIntegrationsData() {
    return useQuery({
        queryKey: queryKeys.settings.integrations(),
        queryFn: async (): Promise<IntegrationsData> => {
            const res = await fetch("/api/v1/integrations");
            const contentType = res.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
                throw new Error(`Integrations endpoint returned non-JSON response (${res.status})`);
            }

            const json = await res.json();
            const message =
                (typeof json?.error === "string" && json.error) ||
                (typeof json?.message === "string" && json.message) ||
                `Failed to load integrations data (${res.status})`;
            if (!res.ok || json?.success === false) {
                throw new Error(message);
            }

            return json?.data || DEFAULT_INTEGRATIONS_DATA;
        },
        retry: 1,
        staleTime: 60_000,
        gcTime: 5 * 60_000,
    });
}

async function submitPasswordChangeRequest({
    currentPassword,
    newPassword,
}: {
    currentPassword: string;
    newPassword: string;
}) {
    const toFailure = (message: string, errorCode?: string) => ({ success: false as const, message, errorCode });
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
                        return toFailure(message, typeof errorJson?.errorCode === "string" ? errorJson.errorCode : undefined);
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
            return toFailure(message, typeof json?.errorCode === "string" ? json.errorCode : undefined);
        }
        const success = typeof json?.success === "boolean" ? json.success : true;
        const message = typeof json?.message === "string" ? json.message : undefined;
        return { success, message, data: json?.data };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to change password. Please try again.";
        return toFailure(message);
    }
}

export async function fetchSecurityStepUpCapabilities(): Promise<SecurityStepUpCapabilitiesData> {
    const res = await fetch("/api/v1/auth/security-step-up");
    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const json = isJson ? await res.json() : null;

    if (!res.ok || json?.success === false) {
        throw new Error(
            json?.message
                || json?.error
                || `Failed to load security verification options (${res.status})`,
        );
    }

    return (json?.data || { availableMethods: [] }) as SecurityStepUpCapabilitiesData;
}

export function useChangePassword() {
    return useMutation({
        mutationFn: submitPasswordChangeRequest,
    });
}

export function useEnableEmailSignIn() {
    return useMutation({
        mutationFn: async ({ newPassword }: { newPassword: string }) =>
            submitPasswordChangeRequest({
                currentPassword: "",
                newPassword,
            }),
    });
}

// Privacy settings
export function usePrivacySettings() {
    return useQuery({
        queryKey: queryKeys.settings.privacy(),
        queryFn: async (): Promise<PrivacyData> => {
            const res = await fetch("/api/v1/privacy");
            const contentType = res.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
                throw new Error(`Privacy endpoint returned non-JSON response (${res.status})`);
            }
            const json = await res.json();
            if (!res.ok || json?.success === false) {
                const message =
                    (typeof json?.error === "string" && json.error) ||
                    (typeof json?.message === "string" && json.message) ||
                    `Failed to load privacy settings (${res.status})`;
                throw new Error(message);
            }
            return json?.data || DEFAULT_PRIVACY_SETTINGS;
        },
    });
}

// Prefetch hooks
export function usePrefetchSettings() {
    const queryClient = useQueryClient();

    const prefetchNotifications = () => {
        queryClient.prefetchQuery({
            queryKey: queryKeys.settings.notifications(),
            queryFn: async () => {
                const result = await readNotificationPreferencesAction();
                if (!result.success) {
                    console.warn("[settings] notification preferences prefetch failed", result.error);
                    return DEFAULT_NOTIFICATION_PREFERENCES;
                }

                return normalizeNotificationPreferences(result.preferences);
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
                const res = await fetch("/api/v1/privacy");
                const contentType = res.headers.get("content-type") || "";
                if (!contentType.includes("application/json")) {
                    throw new Error(`Privacy endpoint returned non-JSON response (${res.status})`);
                }
                const json = await res.json();
                if (!res.ok || json?.success === false) {
                    const message =
                        (typeof json?.error === "string" && json.error) ||
                        (typeof json?.message === "string" && json.message) ||
                        `Failed to load privacy settings (${res.status})`;
                    throw new Error(message);
                }
                return json?.data || DEFAULT_PRIVACY_SETTINGS;
            },
        });
    };

    return {
        prefetchNotifications,
        prefetchSecurity,
        prefetchPrivacy,
    };
}
