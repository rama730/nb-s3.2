import { createClient } from '@/lib/supabase/server';
import { persistGithubImportAccessCookie, readGithubImportAccessCookie } from '@/lib/github/import-access-cookie';
import { buildGithubAccountConnectionState } from '@/lib/github/connection-state';
import type { GithubImportAccessState } from '@/lib/github/import-types';
import { openGithubImportToken, sealGithubImportToken } from '@/lib/github/repo-security';
import { resolveGithubExternalAccountHealth } from '@/lib/github/account-health';

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

  const sessionProviderToken =
    typeof session?.provider_token === 'string'
      ? session.provider_token.trim()
      : '';

  const cookieSealed = await readGithubImportAccessCookie();
  let sealedImportToken = cookieSealed;
  let didReseal = false;

  if (sessionProviderToken) {
    const existingPlain = openGithubImportToken(cookieSealed);
    if (existingPlain !== sessionProviderToken) {
      sealedImportToken = sealGithubImportToken(sessionProviderToken);
      didReseal = true;
    }
  }

  if (didReseal && sealedImportToken) {
    await persistGithubImportAccessCookie(sealedImportToken);
  }

  const plainImportToken = openGithubImportToken(sealedImportToken);
  const accountHealth = await resolveGithubExternalAccountHealth({
    linked: githubConnection.linked,
    username: githubConnection.username,
  });
  const accountCanAuthorize = accountHealth.state !== 'unavailable';

  const result: GithubImportAccessState = {
    linked: githubConnection.linked,
    username: githubConnection.username,
    repoAccess: accountCanAuthorize && Boolean(plainImportToken),
    refreshRequired:
      githubConnection.linked && (!plainImportToken || accountHealth.state === 'unavailable'),
    sealedImportToken: sealedImportToken ?? null,
    accountHealth,
  };

  return {
    success: true as const,
    ...result,
  };
}
