import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { normalizeAuthNextPath, resolveAuthBaseUrl } from '@/lib/auth/redirects'
import { getAuthHardeningPhase } from '@/lib/auth/hardening'
import { setGithubImportAccessCookie } from '@/lib/github/import-access-cookie'
import { sealGithubImportToken } from '@/lib/github/repo-security'
import { isCompletedOnboardingStatus } from '@/lib/onboarding/state'

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
    const response = NextResponse.redirect(successUrl)
    const providerToken = typeof (data?.session as { provider_token?: unknown } | null | undefined)?.provider_token === 'string'
        ? (data?.session as { provider_token?: string }).provider_token?.trim() || ''
        : ''
    if (provider === 'github' && providerToken) {
        const sealed = sealGithubImportToken(providerToken)
        if (sealed) {
            setGithubImportAccessCookie(response, sealed)
        }
    }
    response.headers.set('x-request-id', requestId)
    return response
}
