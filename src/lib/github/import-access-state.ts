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
    { data: { user } },
    { data: { session } },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ]);

  if (!user?.id) {
    return {
      success: false as const,
      error: 'Unauthorized. Please sign in first.',
    };
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
