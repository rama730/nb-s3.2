"use client";

import { useCallback } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  AccountDeletionStatusData,
  ExtensionSessionData,
  ExtensionSessionsData,
  IntegrationsData,
  NotificationPreferences,
  PrivacyData,
  SecurityData,
  SecurityStepUpCapabilitiesData,
  SettingsBootstrapData,
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
    visitorProfileHref: null,
  },
};

export const DEFAULT_SECURITY_DATA: SecurityData = {
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

export const DEFAULT_INTEGRATIONS_DATA: IntegrationsData = {
  createdWith: null,
  createdWithLabel: "Unknown",
  emailAddress: null,
  emailVerified: false,
  linkedCount: 0,
  additionalLinkedCount: 0,
  summary: "We could not determine how this account was created yet.",
  recommendedNextStep:
    "Use your current sign-in method to keep this account accessible.",
  infoNote:
    "You may see only one sign-in method if this account has not been linked to any additional providers.",
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
      detail:
        "Repository import and sync become available after GitHub is attached to this account and used on a project.",
      usageCount: 0,
    },
  ],
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
    throw new Error(message);
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

async function fetchSettingsBootstrap(): Promise<SettingsBootstrapData> {
  const res = await fetch("/api/v1/settings/bootstrap");
  return parseJsonResponse<SettingsBootstrapData>(
    res,
    "Failed to load settings bootstrap",
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

export function seedSettingsQueriesFromBootstrap(
  queryClient: QueryClient,
  bootstrap: SettingsBootstrapData | null | undefined,
) {
  if (!bootstrap) return;
  queryClient.setQueryData(queryKeys.settings.bootstrap(), bootstrap);
  if (bootstrap.accountDeletion) {
    queryClient.setQueryData(
      queryKeys.settings.accountDeletion(),
      bootstrap.accountDeletion,
    );
  }
  if (bootstrap.notifications) {
    queryClient.setQueryData(
      queryKeys.settings.notifications(),
      normalizeNotificationPreferences(bootstrap.notifications),
    );
  }
  if (bootstrap.security) {
    queryClient.setQueryData(queryKeys.settings.security(), bootstrap.security);
  }
  if (bootstrap.privacy) {
    queryClient.setQueryData(queryKeys.settings.privacy(), bootstrap.privacy);
  }
  if (bootstrap.integrations) {
    queryClient.setQueryData(
      queryKeys.settings.integrations(),
      bootstrap.integrations,
    );
  }
  if (bootstrap.extensionSessions) {
    queryClient.setQueryData(
      queryKeys.settings.extensionSessions(),
      bootstrap.extensionSessions,
    );
  }
}

function getCachedSettingsBootstrap(queryClient: QueryClient) {
  return queryClient.getQueryData<SettingsBootstrapData>(
    queryKeys.settings.bootstrap(),
  );
}

function getBootstrapUpdatedAt(queryClient: QueryClient) {
  const fetchedAt = getCachedSettingsBootstrap(queryClient)?.fetchedAt;
  if (!fetchedAt) return undefined;
  const parsed = Date.parse(fetchedAt);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getInitialBootstrapUpdatedAt(
  bootstrap: SettingsBootstrapData | null | undefined,
) {
  if (!bootstrap) return undefined;
  const parsed = Date.parse(bootstrap.fetchedAt);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function useSettingsBootstrap(
  initialBootstrap?: SettingsBootstrapData | null,
) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: queryKeys.settings.bootstrap(),
    queryFn: async () => {
      const bootstrap = await fetchSettingsBootstrap();
      seedSettingsQueriesFromBootstrap(queryClient, bootstrap);
      return bootstrap;
    },
    initialData: initialBootstrap ?? undefined,
    initialDataUpdatedAt: getInitialBootstrapUpdatedAt(initialBootstrap),
    enabled: initialBootstrap === undefined,
    staleTime: SETTINGS_STALE_MS,
    gcTime: SETTINGS_GC_MS,
    retry: 1,
  });
}

export function useAccountDeletionStatus() {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: queryKeys.settings.accountDeletion(),
    queryFn: fetchAccountDeletionStatus,
    initialData: () => getCachedSettingsBootstrap(queryClient)?.accountDeletion,
    initialDataUpdatedAt: () => getBootstrapUpdatedAt(queryClient),
    staleTime: SETTINGS_SECONDARY_STALE_MS,
    gcTime: SETTINGS_GC_MS,
  });
}

// Notification preferences
export function useNotificationPreferences() {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: queryKeys.settings.notifications(),
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
    initialData: () => {
      const preferences =
        getCachedSettingsBootstrap(queryClient)?.notifications;
      return preferences
        ? normalizeNotificationPreferences(preferences)
        : undefined;
    },
    initialDataUpdatedAt: () => getBootstrapUpdatedAt(queryClient),
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
    onError: (err, newPrefs, context) => {
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
  const queryClient = useQueryClient();
  const hardeningEnabled = options?.hardeningEnabled ?? false;

  return useQuery({
    queryKey: queryKeys.settings.security(),
    queryFn: fetchSecurityData,
    retry: 1,
    initialData: () => getCachedSettingsBootstrap(queryClient)?.security,
    initialDataUpdatedAt: () => getBootstrapUpdatedAt(queryClient),
    staleTime: hardeningEnabled
      ? SETTINGS_SECURITY_STALE_MS
      : SETTINGS_STALE_MS,
    gcTime: SETTINGS_GC_MS,
  });
}

export function useIntegrationsData() {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: queryKeys.settings.integrations(),
    queryFn: fetchIntegrationsData,
    retry: 1,
    initialData: () => getCachedSettingsBootstrap(queryClient)?.integrations,
    initialDataUpdatedAt: () => getBootstrapUpdatedAt(queryClient),
    staleTime: SETTINGS_STALE_MS,
    gcTime: SETTINGS_GC_MS,
  });
}

export function useExtensionSessionsData() {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: queryKeys.settings.extensionSessions(),
    queryFn: fetchExtensionSessionsData,
    initialData: () =>
      getCachedSettingsBootstrap(queryClient)?.extensionSessions,
    initialDataUpdatedAt: () => getBootstrapUpdatedAt(queryClient),
    staleTime: SETTINGS_SECONDARY_STALE_MS,
    gcTime: SETTINGS_GC_MS,
  });
}

async function submitPasswordChangeRequest({
  currentPassword,
  newPassword,
}: {
  currentPassword: string;
  newPassword: string;
}) {
  const toFailure = (message: string, errorCode?: string) => ({
    success: false as const,
    message,
    errorCode,
  });
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
            return toFailure(
              message,
              typeof errorJson?.errorCode === "string"
                ? errorJson.errorCode
                : undefined,
            );
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
      return toFailure(
        message,
        typeof json?.errorCode === "string" ? json.errorCode : undefined,
      );
    }
    const success = typeof json?.success === "boolean" ? json.success : true;
    const message =
      typeof json?.message === "string" ? json.message : undefined;
    return { success, message, data: json?.data };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to change password. Please try again.";
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
      json?.message ||
        json?.error ||
        `Failed to load security verification options (${res.status})`,
    );
  }

  return (json?.data || {
    availableMethods: [],
  }) as SecurityStepUpCapabilitiesData;
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
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: queryKeys.settings.privacy(),
    queryFn: fetchPrivacyData,
    initialData: () => getCachedSettingsBootstrap(queryClient)?.privacy,
    initialDataUpdatedAt: () => getBootstrapUpdatedAt(queryClient),
    staleTime: SETTINGS_STALE_MS,
    gcTime: SETTINGS_GC_MS,
  });
}

// Prefetch hooks
export function usePrefetchSettings() {
  const queryClient = useQueryClient();

  const seedFromCachedBootstrap = useCallback(() => {
    const cachedBootstrap = getCachedSettingsBootstrap(queryClient);
    if (cachedBootstrap) {
      seedSettingsQueriesFromBootstrap(queryClient, cachedBootstrap);
    }
  }, [queryClient]);

  const prefetchBootstrap = useCallback(() => {
    return queryClient.prefetchQuery({
      queryKey: queryKeys.settings.bootstrap(),
      queryFn: async () => {
        const bootstrap = await fetchSettingsBootstrap();
        seedSettingsQueriesFromBootstrap(queryClient, bootstrap);
        return bootstrap;
      },
      staleTime: SETTINGS_STALE_MS,
      gcTime: SETTINGS_GC_MS,
    });
  }, [queryClient]);

  const prefetchAccount = useCallback(() => {
    seedFromCachedBootstrap();
    return queryClient.prefetchQuery({
      queryKey: queryKeys.settings.accountDeletion(),
      queryFn: fetchAccountDeletionStatus,
      staleTime: SETTINGS_SECONDARY_STALE_MS,
      gcTime: SETTINGS_GC_MS,
    });
  }, [queryClient, seedFromCachedBootstrap]);

  const prefetchNotifications = useCallback(() => {
    seedFromCachedBootstrap();
    queryClient.prefetchQuery({
      queryKey: queryKeys.settings.notifications(),
      queryFn: async () => {
        const result = await readNotificationPreferencesAction();
        if (!result.success) {
          console.warn(
            "[settings] notification preferences prefetch failed",
            result.error,
          );
          return DEFAULT_NOTIFICATION_PREFERENCES;
        }

        return normalizeNotificationPreferences(result.preferences);
      },
      staleTime: SETTINGS_STALE_MS,
      gcTime: SETTINGS_GC_MS,
    });
  }, [queryClient, seedFromCachedBootstrap]);

  const prefetchSecurity = useCallback(() => {
    seedFromCachedBootstrap();
    queryClient.prefetchQuery({
      queryKey: queryKeys.settings.security(),
      queryFn: fetchSecurityData,
      retry: 0,
      staleTime: SETTINGS_SECURITY_STALE_MS,
      gcTime: SETTINGS_GC_MS,
    });
  }, [queryClient, seedFromCachedBootstrap]);

  const prefetchPrivacy = useCallback(() => {
    seedFromCachedBootstrap();
    queryClient.prefetchQuery({
      queryKey: queryKeys.settings.privacy(),
      queryFn: fetchPrivacyData,
      staleTime: SETTINGS_STALE_MS,
      gcTime: SETTINGS_GC_MS,
    });
  }, [queryClient, seedFromCachedBootstrap]);

  const prefetchIntegrations = useCallback(() => {
    seedFromCachedBootstrap();
    queryClient.prefetchQuery({
      queryKey: queryKeys.settings.integrations(),
      queryFn: fetchIntegrationsData,
      retry: 0,
      staleTime: SETTINGS_STALE_MS,
      gcTime: SETTINGS_GC_MS,
    });
    queryClient.prefetchQuery({
      queryKey: queryKeys.settings.extensionSessions(),
      queryFn: fetchExtensionSessionsData,
      retry: 0,
      staleTime: SETTINGS_SECONDARY_STALE_MS,
      gcTime: SETTINGS_GC_MS,
    });
  }, [queryClient, seedFromCachedBootstrap]);

  const prefetchTab = useCallback(
    (tabId: string) => {
      seedFromCachedBootstrap();
      switch (tabId) {
        case "account":
          return void prefetchAccount();
        case "security":
          return void prefetchSecurity();
        case "privacy":
          return void prefetchPrivacy();
        case "notifications":
          return void prefetchNotifications();
        case "integrations":
          return void prefetchIntegrations();
        default:
          return undefined;
      }
    },
    [
      prefetchAccount,
      prefetchIntegrations,
      prefetchNotifications,
      prefetchPrivacy,
      prefetchSecurity,
      seedFromCachedBootstrap,
    ],
  );

  const prefetchAll = useCallback(() => {
    seedFromCachedBootstrap();
    void prefetchBootstrap();
    void prefetchAccount();
    void prefetchNotifications();
    void prefetchSecurity();
    void prefetchPrivacy();
    void prefetchIntegrations();
  }, [
    prefetchAccount,
    prefetchBootstrap,
    prefetchIntegrations,
    prefetchNotifications,
    prefetchPrivacy,
    prefetchSecurity,
    seedFromCachedBootstrap,
  ]);

  return {
    prefetchBootstrap,
    prefetchAccount,
    prefetchNotifications,
    prefetchSecurity,
    prefetchPrivacy,
    prefetchIntegrations,
    prefetchTab,
    prefetchAll,
  };
}
