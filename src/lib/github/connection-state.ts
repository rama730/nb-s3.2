import type { User } from "@supabase/supabase-js";

import { getLinkedAccountProviders } from "@/lib/auth/account-identity";

export type GithubAccountConnectionState = {
  linked: boolean;
  username: string | null;
  avatarUrl: string | null;
  fullName: string | null;
};

type ProviderSession = {
  provider_token?: unknown;
} | null | undefined;

export function getLinkedGithubIdentityIds(
  user: User | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const identity of user?.identities || []) {
    if (identity.provider !== "github") continue;
    for (const candidate of [
      identity.id,
      identity.identity_data?.provider_id,
      identity.identity_data?.sub,
    ]) {
      if (candidate !== null && candidate !== undefined && String(candidate)) {
        ids.add(String(candidate));
      }
    }
  }
  return ids;
}

/**
 * Supabase's provider token belongs to the provider that authenticated the
 * session, not every linked identity. Never let a Google-primary session
 * overwrite the separately sealed GitHub repository grant.
 */
export function readGithubSessionProviderToken(
  user: User | null | undefined,
  session: ProviderSession,
): string {
  if (user?.app_metadata?.provider !== "github") return "";
  return typeof session?.provider_token === "string"
    ? session.provider_token.trim()
    : "";
}

function readGithubIdentityUsername(identity: unknown): string | null {
  if (!identity || typeof identity !== "object") {
    return null;
  }

  const record = identity as Record<string, unknown>;
  const identityData =
    record.identity_data && typeof record.identity_data === "object"
      ? (record.identity_data as Record<string, unknown>)
      : null;

  const candidates = [
    identityData?.user_name,
    identityData?.preferred_username,
    identityData?.login,
    record.user_name,
    record.preferred_username,
    record.login,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

function readGithubIdentityAvatar(identity: unknown): string | null {
  if (!identity || typeof identity !== "object") {
    return null;
  }

  const record = identity as Record<string, unknown>;
  const identityData =
    record.identity_data && typeof record.identity_data === "object"
      ? (record.identity_data as Record<string, unknown>)
      : null;

  const candidates = [
    identityData?.avatar_url,
    identityData?.avatar,
    record.avatar_url,
    record.avatar,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

function readGithubIdentityFullName(identity: unknown): string | null {
  if (!identity || typeof identity !== "object") {
    return null;
  }

  const record = identity as Record<string, unknown>;
  const identityData =
    record.identity_data && typeof record.identity_data === "object"
      ? (record.identity_data as Record<string, unknown>)
      : null;

  const candidates = [
    identityData?.full_name,
    identityData?.name,
    record.full_name,
    record.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

export function buildGithubAccountConnectionState(
  user: User | null | undefined,
): GithubAccountConnectionState {
  if (!user) {
    return {
      linked: false,
      username: null,
      avatarUrl: null,
      fullName: null,
    };
  }

  const linked = getLinkedAccountProviders(user).includes("github");
  const githubIdentity = Array.isArray(user.identities)
    ? user.identities.find(
        (identity) =>
          identity &&
          typeof identity.provider === "string" &&
          identity.provider.trim().toLowerCase() === "github",
      )
    : null;

  let username = readGithubIdentityUsername(githubIdentity);
  let avatarUrl = readGithubIdentityAvatar(githubIdentity);
  let fullName = readGithubIdentityFullName(githubIdentity);

  if (linked) {
    const meta = user.user_metadata || {};
    if (!username) {
      const candidates = [meta.user_name, meta.preferred_username, meta.login, meta.username, user.email?.split("@")[0]];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          username = candidate.trim();
          break;
        }
      }
    }
    if (!avatarUrl) {
      const candidates = [meta.avatar_url, meta.avatar, meta.picture];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          avatarUrl = candidate.trim();
          break;
        }
      }
    }
    if (!fullName) {
      const candidates = [meta.full_name, meta.name];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          fullName = candidate.trim();
          break;
        }
      }
    }
  }

  return {
    linked,
    username,
    avatarUrl,
    fullName,
  };
}
