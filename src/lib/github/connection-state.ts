import type { User } from "@supabase/supabase-js";

export type GithubAccountConnectionState = {
  linked: boolean;
  githubId: number | null;
  username: string | null;
  avatarUrl: string | null;
  fullName: string | null;
};

function readGithubIdentityId(identity: unknown): number | null {
  if (!identity || typeof identity !== "object") return null;
  const record = identity as Record<string, unknown>;
  const identityData =
    record.identity_data && typeof record.identity_data === "object"
      ? (record.identity_data as Record<string, unknown>)
      : null;

  // GitHub's numeric account id survives login renames. Supabase's own
  // identity UUID is deliberately excluded because it is not a GitHub id.
  for (const candidate of [identityData?.provider_id, identityData?.sub]) {
    const parsed =
      typeof candidate === "number"
        ? candidate
        : typeof candidate === "string" && /^\d+$/.test(candidate.trim())
          ? Number(candidate)
          : Number.NaN;
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

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

  // Fall back to user metadata when the identities list was not loaded (e.g. from JWT snapshot)
  if (ids.size === 0 && user) {
    const appProviders = Array.isArray(user.app_metadata?.providers)
      ? user.app_metadata.providers
      : [];
    if (
      appProviders.some((p) => typeof p === "string" && p.trim().toLowerCase() === "github") ||
      user.app_metadata?.provider === "github"
    ) {
      const meta = (user.user_metadata || {}) as Record<string, unknown>;
      for (const candidate of [meta.provider_id, meta.sub]) {
        if (candidate !== null && candidate !== undefined && String(candidate)) {
          ids.add(String(candidate));
        }
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
      githubId: null,
      username: null,
      avatarUrl: null,
      fullName: null,
    };
  }

  const githubIdentity = Array.isArray(user.identities)
    ? user.identities.find(
        (identity) =>
          identity &&
          typeof identity.provider === "string" &&
          identity.provider.trim().toLowerCase() === "github",
      )
    : null;
  // The identity list is the authoritative link state. app_metadata can lag
  // briefly after unlinking and must not resurrect a detached provider.
  const linked = Boolean(githubIdentity);

  let username = readGithubIdentityUsername(githubIdentity);
  const githubId = readGithubIdentityId(githubIdentity);
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
    githubId,
    username,
    avatarUrl,
    fullName,
  };
}
