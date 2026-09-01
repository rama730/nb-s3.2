import "server-only";

import type { Session, User } from "@supabase/supabase-js";

import {
  getLinkedGithubIdentityIds,
  readGithubSessionProviderToken,
} from "@/lib/github/connection-state";
import { readGithubImportAccessCookie } from "@/lib/github/import-access-cookie";
import { openGithubImportToken } from "@/lib/github/repo-security";
import { syncGithub } from "@/lib/github/sync-api";

type GithubTokenAccount = { id: number; login: string };
type GithubAccountLookup = (token: string) => Promise<GithubTokenAccount>;

export async function validateGithubUserAccessToken(
  user: User,
  token: string,
  lookup: GithubAccountLookup = (candidate) =>
    syncGithub<GithubTokenAccount>(candidate, "/user"),
): Promise<GithubTokenAccount | null> {
  const identityIds = getLinkedGithubIdentityIds(user);
  if (!identityIds.size || !token) return null;
  try {
    const account = await lookup(token);
    return identityIds.has(String(account.id)) ? account : null;
  } catch {
    return null;
  }
}

/** Returns only a GitHub token proven to belong to this Supabase user. */
export async function resolveGithubUserAccessToken(
  user: User,
  session: Session | null | undefined,
): Promise<string | null> {
  // This token was already bound to the OAuth callback's authenticated GitHub
  // identity before the server sealed it. Re-querying /user here creates a
  // second, failure-prone source of truth and caused the restore loop.
  const sealedToken = openGithubImportToken(await readGithubImportAccessCookie());
  if (sealedToken) return sealedToken;

  const sessionToken = readGithubSessionProviderToken(user, session);
  if (sessionToken && await validateGithubUserAccessToken(user, sessionToken)) {
    return sessionToken;
  }
  return null;
}
