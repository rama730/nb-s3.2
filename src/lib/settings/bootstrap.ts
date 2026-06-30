import "server-only";

import {
  and,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import type { User } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import {
  accountDeletions,
  profiles,
  projects,
  projectMembers,
} from "@/lib/db/schema";
import { resolvePasswordCredentialState } from "@/lib/auth/account-identity";
import { getSessionIdentifierFromSession } from "@/lib/auth/session-identifier";
import {
  getViewerAuthContext,
  type ViewerAuthContext,
} from "@/lib/server/viewer-context";
import { getProtectedRecoveryCodes } from "@/lib/services/profile-service";
import {
  getLatestPasswordChangeAt,
  listSecurityActivity,
} from "@/lib/security/audit";
import {
  getVerifiedTotpFactors,
  listSecurityMfaFactors,
} from "@/lib/security/mfa";
import { countRemainingRecoveryCodes } from "@/lib/security/recovery-codes";
import {
  listActiveSessions,
  listLoginHistory,
} from "@/lib/security/session-activity";
import { isSecurityHardeningEnabled } from "@/lib/features/security";
import { listPrivacyActivity } from "@/lib/privacy/audit";
import {
  getPrivacySettingsPayload,
  listBlockedAccounts,
} from "@/lib/privacy/settings";
import { buildIntegrationsData } from "@/lib/settings/integrations";
import { listActiveExtensionSessionsForUser } from "@/lib/extension/active-sessions";
import { normalizeNotificationPreferences } from "@/lib/notifications/preferences";
import { parseAppearanceSnapshot } from "@/lib/theme/appearance";
import { logger } from "@/lib/logger";
import type {
  AccountDeletionStatusData,
  ExtensionSessionsData,
  IntegrationsData,
  NotificationPreferences,
  PrivacyData,
  SecurityData,
  SettingsAppearanceBootstrapData,
  SettingsBootstrapData,
} from "@/lib/types/settingsTypes";

type BootstrapAuth = Pick<ViewerAuthContext, "supabase" | "user"> & {
  user: User;
};

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return typeof value === "string" ? value : value.toISOString();
}

function getVisibilitySummary(value: "public" | "connections" | "private") {
  if (value === "connections") return "connections only";
  return value;
}

function getProfilePreview(value: "public" | "connections" | "private") {
  if (value === "private") {
    return "Strangers see a locked profile shell with only limited identity and the actions you allow.";
  }
  if (value === "connections") {
    return "Strangers can still find you, but only accepted connections can open the full profile.";
  }
  return "Your full profile is open. Messaging and request rules still apply separately.";
}

function getInteractionPreview(
  messagePrivacy: "everyone" | "connections",
  connectionPrivacy: "everyone" | "mutuals_only" | "nobody",
) {
  const messages =
    messagePrivacy === "everyone"
      ? "Anyone can message you."
      : "Only connections can message you.";
  const requests =
    connectionPrivacy === "mutuals_only"
      ? "Only mutual connections can send requests."
      : connectionPrivacy === "nobody"
        ? "New connection requests are turned off."
        : "Anyone eligible can send a connection request.";
  return `${messages} ${requests}`;
}

function formatPrivacyActivityEntry(
  entry: Awaited<ReturnType<typeof listPrivacyActivity>>[number],
) {
  switch (entry.eventType) {
    case "profile_visibility_changed": {
      const nextVisibility =
        typeof entry.nextValue?.visibility === "string"
          ? entry.nextValue.visibility
          : "public";
      return {
        id: entry.id,
        eventType: entry.eventType,
        createdAt: entry.createdAt,
        label: "Profile visibility updated",
        summary: `Profile visibility changed to ${getVisibilitySummary(nextVisibility as "public" | "connections" | "private")}.`,
      };
    }
    case "message_privacy_changed": {
      const nextValue =
        typeof entry.nextValue?.messagePrivacy === "string"
          ? entry.nextValue.messagePrivacy
          : "connections";
      return {
        id: entry.id,
        eventType: entry.eventType,
        createdAt: entry.createdAt,
        label: "Messaging updated",
        summary:
          nextValue === "everyone"
            ? "Messages are now open to everyone."
            : "Messages are now limited to connections.",
      };
    }
    case "connection_privacy_changed": {
      const nextValue =
        typeof entry.nextValue?.connectionPrivacy === "string"
          ? entry.nextValue.connectionPrivacy
          : "everyone";
      return {
        id: entry.id,
        eventType: entry.eventType,
        createdAt: entry.createdAt,
        label: "Request permissions updated",
        summary:
          nextValue === "nobody"
            ? "New connection requests are now turned off."
            : nextValue === "mutuals_only"
              ? "Only mutual connections can send new requests."
              : "Connection requests are now open to everyone eligible.",
      };
    }
    case "account_blocked":
      return {
        id: entry.id,
        eventType: entry.eventType,
        createdAt: entry.createdAt,
        label: "Account blocked",
        summary: `Blocked ${typeof entry.metadata?.targetUsername === "string" ? `@${entry.metadata.targetUsername}` : "an account"}.`,
      };
    case "account_unblocked":
      return {
        id: entry.id,
        eventType: entry.eventType,
        createdAt: entry.createdAt,
        label: "Account unblocked",
        summary: "Removed a blocked account restriction.",
      };
    default:
      return {
        id: entry.id,
        eventType: entry.eventType,
        createdAt: entry.createdAt,
        label: "Unknown privacy event",
        summary: "A privacy event was recorded.",
      };
  }
}

async function readNotificationPreferences(
  userId: string,
): Promise<NotificationPreferences> {
  const [row] = await db
    .select({ notificationPreferences: profiles.notificationPreferences })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  return normalizeNotificationPreferences(row?.notificationPreferences);
}

async function readAccountDeletionStatus(
  userId: string,
): Promise<AccountDeletionStatusData> {
  const [activeDeletion] = await db
    .select({
      id: accountDeletions.id,
      hardDeleteAt: accountDeletions.hardDeleteAt,
      scheduledAt: accountDeletions.scheduledAt,
    })
    .from(accountDeletions)
    .where(
      and(
        eq(accountDeletions.userId, userId),
        isNull(accountDeletions.cancelledAt),
        isNull(accountDeletions.completedAt),
      ),
    )
    .orderBy(desc(accountDeletions.scheduledAt))
    .limit(1);

  if (!activeDeletion) return { pending: false };

  return {
    pending: true,
    deletionId: activeDeletion.id,
    hardDeleteAt: activeDeletion.hardDeleteAt.toISOString(),
    scheduledAt: activeDeletion.scheduledAt.toISOString(),
  };
}

async function readSecurityData(auth: BootstrapAuth): Promise<SecurityData> {
  const securityHardeningEnabled = isSecurityHardeningEnabled(auth.user.id);
  const passwordLastChangedAt = await getLatestPasswordChangeAt(auth.user.id);
  const [
    mfaFactors,
    sessionResult,
    loginHistory,
    securityActivity,
    recoveryCodesState,
    assuranceResult,
  ] = await Promise.all([
    listSecurityMfaFactors(auth.supabase),
    auth.supabase.auth.getSession(),
    listLoginHistory(auth.user.id, securityHardeningEnabled ? 20 : 10),
    listSecurityActivity(auth.user.id, securityHardeningEnabled ? 20 : 12),
    getProtectedRecoveryCodes(auth.user.id, { authorized: true }),
    (auth.supabase.auth as any)?.mfa?.getAuthenticatorAssuranceLevel?.() ??
      Promise.resolve(null),
  ]);

  const verifiedTotpFactors = getVerifiedTotpFactors(mfaFactors);
  const session = sessionResult.data?.session;
  const currentSessionId = session
    ? (getSessionIdentifierFromSession(session) ?? null)
    : null;
  const sessions = await listActiveSessions(
    auth.user.id,
    currentSessionId,
    securityHardeningEnabled ? 12 : 8,
  );
  const storedRecoveryCodes = recoveryCodesState?.securityRecoveryCodes ?? [];
  const recoveryCodes =
    verifiedTotpFactors.length === 0 && recoveryCodesState?.hasRecoveryCodes
      ? { configured: false, remainingCount: 0 }
      : {
          configured: recoveryCodesState?.hasRecoveryCodes ?? false,
          remainingCount: countRemainingRecoveryCodes(storedRecoveryCodes),
          ...(recoveryCodesState?.recoveryCodesGeneratedAt
            ? {
                generatedAt:
                  recoveryCodesState.recoveryCodesGeneratedAt.toISOString(),
              }
            : {}),
        };

  return {
    mfaFactors,
    sessions,
    loginHistory,
    password: {
      hasPassword: resolvePasswordCredentialState(
        auth.user,
        passwordLastChangedAt,
      ),
      ...(passwordLastChangedAt
        ? { lastChangedAt: passwordLastChangedAt }
        : {}),
    },
    recoveryCodes,
    securityActivity,
    assurance: {
      currentLevel:
        assuranceResult?.data?.currentLevel === "aal2"
          ? "aal2"
          : assuranceResult?.data?.currentLevel === "aal1"
            ? "aal1"
            : null,
      nextLevel:
        assuranceResult?.data?.nextLevel === "aal2"
          ? "aal2"
          : assuranceResult?.data?.nextLevel === "aal1"
            ? "aal1"
            : null,
    },
  };
}

async function readPrivacyData(userId: string): Promise<PrivacyData> {
  const [settings, blockedAccounts, privacyActivity, profileRow] =
    await Promise.all([
      getPrivacySettingsPayload(userId),
      listBlockedAccounts(userId),
      listPrivacyActivity(userId, 10),
      db
        .select({ username: profiles.username })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);
  const overview = {
    profileVisibility: settings.profileVisibility,
    messagePrivacy: settings.messagePrivacy,
    connectionPrivacy: settings.connectionPrivacy,
    blockedCount: settings.blockedCount,
    summary: `Your profile is visible to ${getVisibilitySummary(settings.profileVisibility)}. ${settings.messagePrivacy === "everyone" ? "Anyone can message you." : "Only connections can message you."} ${settings.connectionPrivacy === "mutuals_only" ? "Only mutual connections can send requests." : settings.connectionPrivacy === "nobody" ? "New connection requests are turned off." : "Anyone eligible can send a connection request."}`,
  };

  return {
    settings,
    blockedAccounts,
    overview,
    privacyActivity: privacyActivity.map(formatPrivacyActivityEntry),
    previews: {
      profileVisibility: getProfilePreview(settings.profileVisibility),
      interactionPermissions: getInteractionPreview(
        settings.messagePrivacy,
        settings.connectionPrivacy,
      ),
      visitorProfileHref: profileRow?.username
        ? `/u/${encodeURIComponent(profileRow.username)}?viewer=visitor`
        : null,
    },
  };
}

async function readIntegrationsData(user: User): Promise<IntegrationsData> {
  const [githubProjectsRows, passwordLastChangedAt] = await Promise.all([
    db
      .select({
        id: projects.id,
        title: projects.title,
        githubRepoUrl: projects.githubRepoUrl,
        githubDefaultBranch: projects.githubDefaultBranch,
        githubLastSyncAt: projects.githubLastSyncAt,
        githubLastCommitSha: projects.githubLastCommitSha,
        syncStatus: projects.syncStatus,
        importSource: projects.importSource,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(
        and(
          sql`(${projects.ownerId} = ${user.id} OR exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.userId} = ${user.id}))`,
          isNull(projects.deletedAt),
          isNotNull(projects.githubRepoUrl),
        ),
      )
      .orderBy(sql`${projects.updatedAt} DESC`),
    getLatestPasswordChangeAt(user.id),
  ]);

  // Auto-timeout stuck in-flight syncs (>15 minutes)
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  for (const row of githubProjectsRows) {
    const isStuck = 
      (row.syncStatus === "pending" || row.syncStatus === "cloning" || row.syncStatus === "indexing") &&
      row.updatedAt &&
      new Date(row.updatedAt) < fifteenMinutesAgo;

    if (isStuck) {
      const src = row.importSource as any;
      const nextImportSource = {
        ...(src || {}),
        metadata: {
          ...((src?.metadata || {}) as Record<string, unknown>),
          lastError: "Synchronization timed out.",
          syncPhase: "failed",
          syncProgress: null,
        },
      };

      await db
        .update(projects)
        .set({
          syncStatus: "failed",
          importSource: nextImportSource as any,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, row.id));

      row.syncStatus = "failed";
      row.importSource = nextImportSource;
    }
  }

  const githubProjects = githubProjectsRows.map((row) => {
    const src = row.importSource as any;
    const metadata = src?.metadata || {};
    return {
      id: row.id,
      title: row.title || "Untitled Project",
      repoUrl: row.githubRepoUrl || "",
      defaultBranch: row.githubDefaultBranch || "main",
      lastSyncAt: row.githubLastSyncAt ? new Date(row.githubLastSyncAt).toISOString() : null,
      lastCommitSha: row.githubLastCommitSha || null,
      syncStatus: row.syncStatus || "ready",
      syncPhase: metadata.syncPhase || null,
      syncProgress: metadata.syncProgress || null,
    };
  });

  const githubRepoProjectCount = githubProjects.length;
  let githubLastSyncAt: string | null = null;
  for (const row of githubProjectsRows) {
    if (row.githubLastSyncAt) {
      const dateStr = new Date(row.githubLastSyncAt).toISOString().slice(0, 10);
      if (!githubLastSyncAt || dateStr > githubLastSyncAt) {
        githubLastSyncAt = dateStr;
      }
    }
  }

  return buildIntegrationsData({
    user,
    githubRepoProjectCount,
    githubLastSyncAt,
    passwordLastChangedAt: passwordLastChangedAt ?? null,
    githubProjects,
  });
}

async function readExtensionSessions(
  userId: string,
): Promise<ExtensionSessionsData> {
  const page = await listActiveExtensionSessionsForUser(userId, { limit: 50 });

  return {
    sessions: page.sessions.map((session) => ({
      id: session.id,
      tokenPrefix: session.tokenPrefix,
      deviceName: session.deviceName,
      clientVersion: session.clientVersion,
      scopes: session.scopes,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      editorHost: session.editorHost,
      editorName: session.editorName,
      editorPlatform: session.editorPlatform,
      editorVersion: session.editorVersion,
      expiresAt: toIso(session.expiresAt),
      lastSeenAt: toIso(session.lastSeenAt),
      createdAt: toIso(session.createdAt),
      authMethod: session.authMethod,
    })),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  };
}

function readAppearanceData(user: User): SettingsAppearanceBootstrapData {
  const metadata =
    user.user_metadata && typeof user.user_metadata === "object"
      ? (user.user_metadata as Record<string, unknown>)
      : {};

  return {
    userId: user.id,
    snapshot: parseAppearanceSnapshot(metadata.app_appearance),
  };
}

async function optionalSection<T>(
  action: string,
  load: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    logger.warn("settings.bootstrap.section_failed", {
      module: "settings",
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

export async function getSettingsBootstrapForViewer(
  auth: BootstrapAuth,
): Promise<SettingsBootstrapData> {
  const [
    accountDeletion,
    notifications,
    privacy,
    security,
    integrations,
    extensionSessions,
  ] = await Promise.all([
    optionalSection("settings.account_deletion.bootstrap", () =>
      readAccountDeletionStatus(auth.user.id),
    ),
    optionalSection("settings.notifications.bootstrap", () =>
      readNotificationPreferences(auth.user.id),
    ),
    optionalSection("settings.privacy.bootstrap", () =>
      readPrivacyData(auth.user.id),
    ),
    optionalSection("settings.security.bootstrap", () =>
      readSecurityData(auth),
    ),
    optionalSection("settings.integrations.bootstrap", () =>
      readIntegrationsData(auth.user),
    ),
    optionalSection("settings.extension_sessions.bootstrap", () =>
      readExtensionSessions(auth.user.id),
    ),
  ]);

  return {
    fetchedAt: new Date().toISOString(),
    ...(accountDeletion ? { accountDeletion } : {}),
    ...(notifications ? { notifications } : {}),
    ...(privacy ? { privacy } : {}),
    ...(security ? { security } : {}),
    ...(integrations ? { integrations } : {}),
    ...(extensionSessions ? { extensionSessions } : {}),
    appearance: readAppearanceData(auth.user),
  };
}

export async function getSettingsBootstrap(): Promise<SettingsBootstrapData | null> {
  const auth = await getViewerAuthContext();
  if (!auth.user) return null;
  return getSettingsBootstrapForViewer({
    supabase: auth.supabase,
    user: auth.user,
  });
}
