"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AccountDeletionStatusData,
  ExtensionSessionData,
  ExtensionSessionsData,
  IntegrationsData,
  NotificationPreferences,
  PrivacyData,
  SecurityData,
} from "@/lib/types/settingsTypes";
import { queryKeys } from "@/lib/query-keys";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
} from "@/lib/notifications/preferences";
import {
  readNotificationPreferencesAction,
  updateNotificationPreferencesAction,
} from "@/app/actions/notifications";
import { getAccountDeletionStatus } from "@/app/actions/account";
import { getActiveExtensionSessions } from "@/app/actions/extension-sessions";

export const SETTINGS_STALE_MS = 2 * 60_000;
export const SETTINGS_SECURITY_STALE_MS = 60_000;
export const SETTINGS_SECONDARY_STALE_MS = 60_000;
export const SETTINGS_GC_MS = 10 * 60_000;
export const EXTENSION_SESSION_POLL_MS = 3_000;

export const DEFAULT_PRIVACY_SETTINGS: PrivacyData = {
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
    summary:
      "Your profile is visible to public. Messages are open to connections only. Connection requests are open to everyone.",
  },
  privacyActivity: [],
  previews: {
    profileVisibility:
      "Your full profile is open. Messaging and request rules still apply separately.",
    interactionPermissions:
      "Only connections can message you. Anyone eligible can send a connection request.",
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
  summary: "We could not determine how this account was created yet.",
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
  githubService: {
    status: "not_connected",
    summary: "No GitHub repository access is currently in use.",
    detail: "Connect GitHub from a project when repository access is needed.",
    usageCount: 0,
  },
};

export const DEFAULT_ACCOUNT_DELETION_STATUS: AccountDeletionStatusData = {
  pending: false,
};

export const DEFAULT_EXTENSION_SESSIONS_DATA: ExtensionSessionsData = {
  sessions: [],
  hasMore: false,
  nextCursor: null,
};

async function parseJsonResponse<T>(
  res: Response,
  fallbackMessage: string,
): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `${fallbackMessage} returned non-JSON response (${res.status})`,
    );
  }

  const json = await res.json();
  const message =
    (typeof json?.error === "string" && json.error) ||
    (typeof json?.message === "string" && json.message) ||
    `${fallbackMessage} (${res.status})`;
  if (!res.ok || json?.success === false) {
    const error = new Error(message) as Error & { errorCode?: string };
    if (typeof json?.errorCode === "string") error.errorCode = json.errorCode;
    throw error;
  }

  return json?.data as T;
}

async function fetchSecurityData(): Promise<SecurityData> {
  const res = await fetch("/api/v1/security");
  return (
    (await parseJsonResponse<SecurityData>(
      res,
      "Failed to load security data",
    )) || DEFAULT_SECURITY_DATA
  );
}

async function fetchIntegrationsData(): Promise<IntegrationsData> {
  const res = await fetch("/api/v1/integrations");
  return (
    (await parseJsonResponse<IntegrationsData>(
      res,
      "Failed to load integrations data",
    )) || DEFAULT_INTEGRATIONS_DATA
  );
}

async function fetchPrivacyData(): Promise<PrivacyData> {
  const res = await fetch("/api/v1/privacy");
  return (
    (await parseJsonResponse<PrivacyData>(
      res,
      "Failed to load privacy settings",
    )) || DEFAULT_PRIVACY_SETTINGS
  );
}

async function fetchAccountDeletionStatus(): Promise<AccountDeletionStatusData> {
  try {
    return await getAccountDeletionStatus();
  } catch {
    return DEFAULT_ACCOUNT_DELETION_STATUS;
  }
}

async function fetchExtensionSessionsData(): Promise<ExtensionSessionsData> {
  const result = await getActiveExtensionSessions();
  if (!result.success || !result.sessions) {
    return DEFAULT_EXTENSION_SESSIONS_DATA;
  }
  return {
    sessions: result.sessions.map(
      (session): ExtensionSessionData => ({
        ...session,
        expiresAt: new Date(session.expiresAt).toISOString(),
        lastSeenAt: new Date(session.lastSeenAt).toISOString(),
        createdAt: new Date(session.createdAt).toISOString(),
      }),
    ),
    hasMore: result.hasMore,
    nextCursor: result.nextCursor,
  };
}

export function useAccountDeletionStatus() {
  return useQuery({
    queryKey: queryKeys.settings.accountDeletion(),
    queryFn: fetchAccountDeletionStatus,
    staleTime: SETTINGS_SECONDARY_STALE_MS,
    gcTime: SETTINGS_GC_MS,
  });
}

// Notification preferences
export function useNotificationPreferences({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.settings.notifications(),
    enabled,
    queryFn: async (): Promise<NotificationPreferences> => {
      const result = await readNotificationPreferencesAction();
      if (!result.success) {
        console.warn(
          "[settings] notification preferences lookup failed",
          result.error,
        );
        return DEFAULT_NOTIFICATION_PREFERENCES;
      }

      return normalizeNotificationPreferences(result.preferences);
    },
    staleTime: SETTINGS_STALE_MS,
    gcTime: SETTINGS_GC_MS,
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (preferences: NotificationPreferences) => {
      const result = await updateNotificationPreferencesAction(
        normalizeNotificationPreferences(preferences),
      );
      if (!result.success || !result.preferences) {
        throw new Error(
          result.error || "Failed to update notification preferences",
        );
      }
      return normalizeNotificationPreferences(result.preferences);
    },
    onMutate: async (newPrefs) => {
      // Optimistic update
      await queryClient.cancelQueries({
        queryKey: queryKeys.settings.notifications(),
      });
      const previous = queryClient.getQueryData(
        queryKeys.settings.notifications(),
      );
      queryClient.setQueryData(
        queryKeys.settings.notifications(),
        normalizeNotificationPreferences(newPrefs),
      );
      return { previous };
    },
    onError: (_error, _preferences, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.settings.notifications(),
          context.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings.notifications(),
      });
    },
  });
}

// Security data
export function useSecurityData(options?: { hardeningEnabled?: boolean }) {
  const hardeningEnabled = options?.hardeningEnabled ?? false;

  return useQuery({
    queryKey: queryKeys.settings.security(),
    queryFn: fetchSecurityData,
    retry: 1,
    staleTime: hardeningEnabled
      ? SETTINGS_SECURITY_STALE_MS
      : SETTINGS_STALE_MS,
    gcTime: SETTINGS_GC_MS,
  });
}

export function useIntegrationsData() {
  return useQuery({
    queryKey: queryKeys.settings.integrations(),
    queryFn: fetchIntegrationsData,
    retry: 1,
    staleTime: SETTINGS_STALE_MS,
    gcTime: SETTINGS_GC_MS,
  });
}

export function useExtensionSessionsData() {
  return useQuery({
    queryKey: queryKeys.settings.extensionSessions(),
    queryFn: fetchExtensionSessionsData,
    staleTime: SETTINGS_SECONDARY_STALE_MS,
    gcTime: SETTINGS_GC_MS,
    // This hook is mounted only by the Integrations tab. Reconcile IDE-side logout
    // without publishing device-session metadata through public Realtime.
    refetchInterval: EXTENSION_SESSION_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

async function submitPasswordChangeRequest({
  currentPassword,
  newPassword,
}: {
  currentPassword: string;
  newPassword: string;
}) {
  try {
    const res = await fetch("/api/v1/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    await parseJsonResponse<unknown>(res, "Password change failed");
    return { success: true as const };
  } catch (error) {
    return {
      success: false as const,
      message: error instanceof Error ? error.message : "Unable to change password. Please try again.",
      errorCode: error instanceof Error && "errorCode" in error ? String(error.errorCode) : undefined,
    };
  }
}

export function useChangePassword() {
  return useMutation({
    mutationFn: submitPasswordChangeRequest,
  });
}

// Privacy settings
export function usePrivacySettings() {
  return useQuery({
    queryKey: queryKeys.settings.privacy(),
    queryFn: fetchPrivacyData,
    staleTime: SETTINGS_STALE_MS,
    gcTime: SETTINGS_GC_MS,
  });
}
