import type {
  ExternalAccountHealth,
  ExternalAccountHealthReason,
} from "@/lib/types/settingsTypes";

const GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 2_000;

type CachedHealth = {
  expiresAt: number;
  value: ExternalAccountHealth;
};

const healthCache = new Map<string, CachedHealth>();

type GithubProfilePayload = {
  login?: unknown;
  name?: unknown;
  avatar_url?: unknown;
  html_url?: unknown;
};

type ResolveGithubAccountHealthInput = {
  linked: boolean;
  githubId?: number | null;
  username: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  cacheTtlMs?: number;
};

export const GITHUB_ACCOUNT_UNAVAILABLE_MESSAGE =
  "This GitHub account is unavailable. It may have been renamed, suspended, or deleted. Replace the stale GitHub connection before retrying.";

export const GITHUB_CONNECTION_REQUIRED_MESSAGE =
  "Reconnect GitHub before syncing this repository.";

function unknownHealth(
  reason: ExternalAccountHealthReason,
  checkedAt: string | null,
): ExternalAccountHealth {
  return {
    state: "unknown",
    reason,
    checkedAt,
    profile: null,
  };
}

function safeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeGithubUrl(value: unknown, fallback: string): string {
  const candidate = safeOptionalString(value);
  if (!candidate) return fallback;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" &&
      (url.hostname === "github.com" || url.hostname === "avatars.githubusercontent.com")
      ? url.toString()
      : fallback;
  } catch {
    return fallback;
  }
}

export function clearGithubAccountHealthCache(username?: string | null) {
  if (!username) {
    healthCache.clear();
    return;
  }
  healthCache.delete(username.trim().toLowerCase());
}

export async function resolveGithubExternalAccountHealth(
  input: ResolveGithubAccountHealthInput,
): Promise<ExternalAccountHealth> {
  if (!input.linked) {
    return {
      state: "not_linked",
      reason: "not_linked",
      checkedAt: null,
      profile: null,
    };
  }

  const githubId = Number.isSafeInteger(input.githubId) && Number(input.githubId) > 0
    ? Number(input.githubId)
    : null;
  const username = input.username?.trim() || "";
  if (!githubId && !username) {
    return unknownHealth("missing_username", null);
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const cacheTtlMs = input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cacheKey = githubId ? `id:${githubId}` : `login:${username.toLowerCase()}`;
  const useSharedCache = !input.fetchImpl && cacheTtlMs > 0;
  const cached = useSharedCache ? healthCache.get(cacheKey) : null;
  if (cached && cached.expiresAt > now()) {
    return cached.value;
  }

  const checkedAt = new Date(now()).toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("GitHub account lookup timed out")),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let value: ExternalAccountHealth;
  try {
    const response = await fetchImpl(
      githubId
        ? `${GITHUB_API_BASE}/user/${githubId}`
        : `${GITHUB_API_BASE}/users/${encodeURIComponent(username)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "nb-s3-integrations",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (response.status === 404 || response.status === 410) {
      value = {
        state: "unavailable",
        reason: "not_found",
        checkedAt,
        profile: null,
      };
    } else if (response.status === 403 || response.status === 429) {
      const rateLimited =
        response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0";
      value = unknownHealth(rateLimited ? "rate_limited" : "forbidden", checkedAt);
    } else if (!response.ok) {
      value = unknownHealth("provider_error", checkedAt);
    } else {
      const payload = (await response.json().catch(() => null)) as GithubProfilePayload | null;
      const liveUsername = safeOptionalString(payload?.login);
      if (!liveUsername) {
        value = unknownHealth("invalid_response", checkedAt);
      } else {
        const profileUrl = `https://github.com/${encodeURIComponent(liveUsername)}`;
        value = {
          state: "available",
          reason: "verified",
          checkedAt,
          profile: {
            username: liveUsername,
            fullName: safeOptionalString(payload?.name),
            avatarUrl: safeGithubUrl(payload?.avatar_url, "") || null,
            profileUrl: safeGithubUrl(payload?.html_url, profileUrl),
          },
        };
      }
    }
  } catch {
    value = unknownHealth("network_error", checkedAt);
  } finally {
    clearTimeout(timeout);
  }

  if (useSharedCache) {
    if (healthCache.size >= MAX_CACHE_ENTRIES && !healthCache.has(cacheKey)) {
      for (const [key, cachedValue] of healthCache) {
        if (cachedValue.expiresAt <= now()) healthCache.delete(key);
      }
      if (healthCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = healthCache.keys().next().value as string | undefined;
        if (oldestKey) healthCache.delete(oldestKey);
      }
    }
    healthCache.set(cacheKey, {
      expiresAt: now() + cacheTtlMs,
      value,
    });
  }

  return value;
}
