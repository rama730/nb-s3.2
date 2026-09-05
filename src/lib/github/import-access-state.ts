import { createClient } from '@/lib/supabase/server';
import { persistGithubImportAccessCookie, readGithubImportAccessCookie } from '@/lib/github/import-access-cookie';
import {
  buildGithubAccountConnectionState,
  readGithubSessionProviderToken,
} from '@/lib/github/connection-state';
import type { GithubImportAccessState } from '@/lib/github/import-types';
import { openGithubImportToken, sealGithubImportToken } from '@/lib/github/repo-security';
import { resolveGithubExternalAccountHealth } from '@/lib/github/account-health';
import { validateGithubUserAccessToken } from '@/lib/github/user-access-token';

export async function getGithubImportAccessState() {
  const supabase = await createClient();
  const [
    { data: initialUserData },
    { data: { session } },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ]);

  let user = initialUserData.user;

  if (!user?.id) {
    return {
      success: false as const,
      error: 'Unauthorized. Please sign in first.',
    };
  }

  if (!Array.isArray(user.identities) || user.identities.length === 0) {
    try {
      const { db } = await import('@/lib/db');
      const { sql } = await import('drizzle-orm');
      const identitiesResult = await db.execute<{
        id: string;
        provider: string;
        identity_data: Record<string, unknown> | null;
      }>(
        sql`SELECT id, provider, identity_data FROM auth.identities WHERE user_id = ${user.id}::uuid ORDER BY last_sign_in_at DESC NULLS LAST, created_at DESC`,
      );
      if (Array.isArray(identitiesResult) && identitiesResult.length > 0) {
        user = {
          ...user,
          identities: identitiesResult.map((row) => ({
            id: String(row.id),
            provider: String(row.provider),
            identity_data: (row.identity_data || {}) as Record<string, unknown>,
          })) as any,
        };
      }
    } catch {
      // Ignore if db unavailable
    }
  }

  const githubConnection = buildGithubAccountConnectionState(user);

  const sessionProviderToken = readGithubSessionProviderToken(user, session);
  const cookieSealed = await readGithubImportAccessCookie();
  const cookieToken = openGithubImportToken(cookieSealed);
  const verifiedSessionAccount = sessionProviderToken
    ? await validateGithubUserAccessToken(user, sessionProviderToken)
    : null;
  const verifiedToken = verifiedSessionAccount
    ? sessionProviderToken
    : cookieToken || '';
  let sealedImportToken = cookieToken ? cookieSealed : null;

  // Session grants still need live validation. Cookie grants were already
  // identity-bound by the OAuth callback before server-side sealing.
  if (verifiedSessionAccount && sessionProviderToken !== cookieToken) {
    sealedImportToken = sealGithubImportToken(sessionProviderToken);
    if (sealedImportToken) await persistGithubImportAccessCookie(sealedImportToken);
  }
  const accountHealth = await resolveGithubExternalAccountHealth({
    linked: githubConnection.linked,
    githubId: githubConnection.githubId,
    username: githubConnection.username,
  });
  const accountCanAuthorize = accountHealth.state !== 'unavailable';

  const result: GithubImportAccessState = {
    linked: githubConnection.linked,
    username: githubConnection.username,
    repoAccess: accountCanAuthorize && Boolean(verifiedToken),
    refreshRequired:
      githubConnection.linked && (!verifiedToken || accountHealth.state === 'unavailable'),
    sealedImportToken: sealedImportToken ?? null,
    accountHealth,
  };

  return {
    success: true as const,
    ...result,
  };
}
