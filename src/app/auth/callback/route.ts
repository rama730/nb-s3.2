import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { normalizeAuthNextPath, resolveAuthBaseUrl } from '@/lib/auth/redirects'
import { getAuthHardeningPhase } from '@/lib/auth/hardening'
import { clearGithubImportAccessCookie, setGithubImportAccessCookie } from '@/lib/github/import-access-cookie'
import { sealGithubImportToken } from '@/lib/github/repo-security'
import { isCompletedOnboardingStatus } from '@/lib/onboarding/state'
import { ensureDefaultGithubContributorIdentity } from '@/lib/github/contributor-identity'

export async function GET(request: Request) {
    const startedAt = Date.now()
    const requestId = crypto.randomUUID()
    const hardeningPhase = getAuthHardeningPhase()
    const requestUrl = new URL(request.url)
    const { searchParams } = requestUrl
    const code = searchParams.get('code')
    const nextPath = normalizeAuthNextPath(searchParams.get('next'))
    const oauthRequestId = searchParams.get('rid')?.trim() || null
    const provider = searchParams.get('provider')?.trim() || 'unknown'
    let baseUrl: string
    try {
        baseUrl = resolveAuthBaseUrl({ requestUrl: request.url, browserOrigin: requestUrl.origin })
    } catch (error) {
        logger.metric('auth.callback.exchange.failure', {
            requestId,
            reason: 'canonical_base_url_missing',
            nextPath,
            path: requestUrl.pathname,
            oauthRequestId,
            provider,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - startedAt,
            phase: hardeningPhase,
        })
        const response = NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
        response.headers.set('x-request-id', requestId)
        return response
    }
    const loginErrorUrl = new URL('/login', baseUrl)
    loginErrorUrl.searchParams.set('error', 'auth-code-error')
    loginErrorUrl.searchParams.set('redirect', nextPath)

    if (!code) {
        logger.metric('auth.callback.exchange.failure', {
            requestId,
            reason: 'missing_code',
            nextPath,
            path: requestUrl.pathname,
            oauthRequestId,
            provider,
            durationMs: Date.now() - startedAt,
            phase: hardeningPhase,
        })
        const response = NextResponse.redirect(loginErrorUrl)
        response.headers.set('x-request-id', requestId)
        return response
    }

    const supabase = await createClient()
    const [{ data: previousUserData }, { data: previousSessionData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
    ])
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
        logger.metric('auth.callback.exchange.failure', {
            requestId,
            reason: 'exchange_failed',
            nextPath,
            path: requestUrl.pathname,
            oauthRequestId,
            provider,
            error: error.message,
            durationMs: Date.now() - startedAt,
            phase: hardeningPhase,
        })
        const response = NextResponse.redirect(loginErrorUrl)
        response.headers.set('x-request-id', requestId)
        return response
    }

    logger.metric('auth.callback.exchange.success', {
        requestId,
        nextPath,
        path: requestUrl.pathname,
        oauthRequestId,
        provider,
        durationMs: Date.now() - startedAt,
        phase: hardeningPhase,
    })

    let destinationPath = nextPath
    try {
        const { data: profile } = await supabase
            .from('profiles')
            .select('username, onboarding_status')
            .eq('id', data.user.id)
            .maybeSingle()
        const complete =
            data.user.app_metadata?.onboarding_complete === true
            || isCompletedOnboardingStatus(profile?.onboarding_status, profile?.username)

        if (!complete) {
            const onboardingUrl = new URL('/onboarding', baseUrl)
            if (nextPath !== '/hub' && nextPath !== '/onboarding') {
                onboardingUrl.searchParams.set('next', nextPath)
            }
            destinationPath = `${onboardingUrl.pathname}${onboardingUrl.search}`
        } else if (nextPath === '/onboarding' || nextPath.startsWith('/onboarding?')) {
            destinationPath = '/hub'
        }
    } catch (profileError) {
        logger.warn('auth.callback.onboarding_resolution_failed', {
            requestId,
            provider,
            error: profileError instanceof Error ? profileError.message : String(profileError),
        })
    }

    const successUrl = new URL(destinationPath, baseUrl)
    const providerToken = typeof (data?.session as { provider_token?: unknown } | null | undefined)?.provider_token === 'string'
        ? (data?.session as { provider_token?: string }).provider_token?.trim() || ''
        : ''
    const previousUser = previousUserData.user
    const expectedUser = previousUser ?? data.user
    const githubIdentityMatches = provider !== 'github'
        || !previousUser
        || previousUser.id === data.user.id
    const githubGrantIsValid = provider === 'github'
        && Boolean(providerToken)
        && githubIdentityMatches

    if (provider === 'github' && !githubGrantIsValid) {
        successUrl.searchParams.set(
            'githubAuth',
            providerToken && !githubIdentityMatches ? 'account_mismatch' : 'token_missing',
        )
    } else if (provider === 'github') {
        successUrl.searchParams.delete('githubAuth')
    }

    // Repository authorization must not replace the account session that
    // initiated it. The browser also retains that session, but restoring it
    // here removes the race between the callback redirect and session bridge.
    if (provider === 'github' && previousSessionData.session && previousUser) {
        await supabase.auth.setSession({
            access_token: previousSessionData.session.access_token,
            refresh_token: previousSessionData.session.refresh_token,
        }).catch((sessionError) => {
            logger.warn('github.repository_auth.session_restore_failed', {
                requestId,
                userId: previousUser.id,
                error: sessionError instanceof Error ? sessionError.message : String(sessionError),
            })
        })
    }

    const response = NextResponse.redirect(successUrl)
    if (provider === 'github') {
        if (!githubGrantIsValid) {
            clearGithubImportAccessCookie(response)
        } else {
            const sealed = sealGithubImportToken(providerToken)
            if (sealed) setGithubImportAccessCookie(response, sealed)
            try {
                await ensureDefaultGithubContributorIdentity(expectedUser.id, providerToken)
            } catch (identityError) {
                // Attribution enrichment must never block a successful OAuth flow.
                logger.warn('github.contributor_identity.default_failed', {
                    requestId,
                    userId: expectedUser.id,
                    error: identityError instanceof Error ? identityError.message : String(identityError),
                })
            }
        }
    }
    response.headers.set('x-request-id', requestId)
    return response
}
