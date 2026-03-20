import type { User } from "@supabase/supabase-js";

import { getLinkedAccountProviders } from "@/lib/auth/account-identity";

export type GithubAccountConnectionState = {
  linked: boolean;
  username: string | null;
};

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

export function buildGithubAccountConnectionState(
  user: User | null | undefined,
): GithubAccountConnectionState {
  if (!user) {
    return {
      linked: false,
      username: null,
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

  return {
    linked,
    username: readGithubIdentityUsername(githubIdentity),
  };
}
