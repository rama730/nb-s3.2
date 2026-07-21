import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { logger } from '@/lib/logger'
import { normalizeAuthNextPath } from '@/lib/auth/redirects'
import { getAuthHardeningPhase } from '@/lib/auth/hardening'
import { classifyAuthLookupError, toAuthErrorMessage } from '@/lib/auth/session-lookup'
import { resolveAuthSnapshot } from '@/lib/auth/snapshot'
import { consumeRouteClassLoadShedding } from '@/lib/routing/load-shedding'
import {
    classifyRoute,
    isAuthOnlyRoute,
    isOnboardingRoute,
    isProtectedAppRoute,
} from '@/lib/routing/route-class'
import { resolveSupabaseServerCookieOptions } from '@/lib/supabase/cookie-options'
import { resolveSupabasePublicEnv } from '@/lib/supabase/env'

const AUTH_DEGRADED_MODE_ENABLED = readBooleanFromEnv('AUTH_DEGRADED_MODE_ENABLED', true)
const AUTH_COOKIE_MARKERS = ['auth-token', 'sb-access-token', 'sb-refresh-token']
const LOG_THROTTLE_MS = 60_000
let lastAuthSnapshotWarnAt = 0

type UpdateSessionOptions = {
    requestHeaders?: Headers
}

function readBooleanFromEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name]
    if (!raw) return fallback
    const value = raw.trim().toLowerCase()
    if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true
    if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false
    return fallback
}

function withRequestId(response: NextResponse, requestId: string, routeClass: string): NextResponse {
    response.headers.set('x-request-id', requestId)
    response.headers.set('x-route-class', routeClass)
    return response
}

function createPassThroughResponse(requestHeaders?: Headers): NextResponse {
    if (!requestHeaders) {
        return NextResponse.next()
    }

    return NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    })
}

function redirectWithRequestId(url: URL, requestId: string, routeClass: string, sourceResponse?: NextResponse): NextResponse {
    const redirectResponse = withRequestId(NextResponse.redirect(url), requestId, routeClass)
    if (sourceResponse) {
        for (const cookie of sourceResponse.cookies.getAll()) {
            redirectResponse.cookies.set(cookie)
        }
    }
    return redirectResponse
}

function getCanonicalPublicUsernamePath(pathname: string): string | null {
    if (!pathname.startsWith('/u/')) return null

    const segments = pathname.split('/')
    if (segments.length !== 3) return null

    const username = segments[2] ?? ''
    if (!username) return null

    const normalizedUsername = username.toLowerCase()
    if (normalizedUsername === username) return null

    return `/u/${normalizedUsername}`
}

function hasAnyAuthCookie(request: NextRequest): boolean {
    const cookies = request.cookies.getAll()
    for (const cookie of cookies) {
        const name = cookie.name.toLowerCase()
        if (!name.includes('sb')) continue
        if (AUTH_COOKIE_MARKERS.some((marker) => name.includes(marker))) return true
    }
    return false
}

async function resolveProfileOnboardingComplete(
    supabase: ReturnType<typeof createServerClient>,
    params: {
        userId: string
        requestId: string
        pathname: string
        routeClass: string
    },
): Promise<boolean> {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('username, onboarding_status')
            .eq('id', params.userId)
            .maybeSingle()

        if (error) {
            logger.warn('[middleware] profile onboarding fallback failed', {
                requestId: params.requestId,
                path: params.pathname,
                routeClass: params.routeClass,
                message: error.message,
            })
            return false
        }

        if (data?.onboarding_status === 'completed') return true
        if (data?.onboarding_status === 'not_started' || data?.onboarding_status === 'in_progress') return false
        const username = typeof data?.username === 'string' ? data.username.trim() : ''
        return username.length > 0
    } catch (error) {
        logger.warn('[middleware] profile onboarding fallback threw', {
            requestId: params.requestId,
            path: params.pathname,
            routeClass: params.routeClass,
            message: error instanceof Error ? error.message : String(error),
        })
        return false
    }
}

function clearAuthCookies(request: NextRequest, response: NextResponse): number {
    const cookieNames = request.cookies.getAll().map((cookie) => cookie.name)
    let cleared = 0
    for (const name of cookieNames) {
        const lowerName = name.toLowerCase()
        if (!lowerName.includes('sb')) continue
        if (!AUTH_COOKIE_MARKERS.some((marker) => lowerName.includes(marker))) continue
        response.cookies.set(name, '', {
            maxAge: 0,
            path: '/',
            expires: new Date(0),
        })
        cleared += 1
    }
    return cleared
}

function shouldLogAuthWarning(now: number): boolean {
    if (now - lastAuthSnapshotWarnAt < LOG_THROTTLE_MS) return false
    lastAuthSnapshotWarnAt = now
    return true
}

export async function updateSession(request: NextRequest, options: UpdateSessionOptions = {}) {
    const requestId = crypto.randomUUID()
    const pathname = request.nextUrl.pathname
    const routeClass = classifyRoute(pathname)
    const hardeningPhase = getAuthHardeningPhase()
    let supabaseResponse = createPassThroughResponse(options.requestHeaders)

    if (pathname.startsWith('/_next')) {
        return withRequestId(createPassThroughResponse(options.requestHeaders), requestId, routeClass)
    }

    // Prevent concurrent refresh token reuse race conditions.
    // Next.js triggers multiple parallel sub-requests (RSC payloads, prefetches) for a single page.
    // Parallel updates with the same refresh token trigger a "refresh_token_already_used" error from GoTrue.
    const isPrefetch = request.headers.get('x-middleware-prefetch') === '1'
    const isRsc = request.headers.has('rsc') || request.headers.get('rsc') === '1' || request.nextUrl.searchParams.has('_rsc')

    if (isPrefetch || isRsc) {
        return withRequestId(supabaseResponse, requestId, routeClass)
    }

    const canonicalPublicUsernamePath = getCanonicalPublicUsernamePath(pathname)
    if (canonicalPublicUsernamePath) {
        const url = request.nextUrl.clone()
        url.pathname = canonicalPublicUsernamePath
        return redirectWithRequestId(url, requestId, routeClass)
    }

    const loadShedding = await consumeRouteClassLoadShedding(routeClass)
    if (!loadShedding.allowed) {
        logger.warn('[middleware] route shed due to overload', {
            requestId,
            path: pathname,
            routeClass,
            resetAt: loadShedding.resetAt ?? null,
            degraded: loadShedding.degraded ?? false,
        })
        return withRequestId(
            NextResponse.json(
                { error: 'Service temporarily overloaded', routeClass },
                {
                    status: 503,
                    headers: {
                        'Retry-After': '5',
                    },
                },
            ),
            requestId,
            routeClass,
        )
    }

    let supabaseEnv: { url: string; anonKey: string }
    try {
        supabaseEnv = resolveSupabasePublicEnv('supabase.middleware')
    } catch (error) {
        logger.error('[middleware] supabase config missing', {
            requestId,
            path: pathname,
            error: error instanceof Error ? error.message : String(error),
        })
        return withRequestId(
            NextResponse.json({ error: 'Server configuration error' }, { status: 500 }),
            requestId,
            routeClass,
        )
    }

    const supabase = createServerClient(
        supabaseEnv.url,
        supabaseEnv.anonKey,
        {
            cookieOptions: resolveSupabaseServerCookieOptions(),
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = createPassThroughResponse(options.requestHeaders)
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    let user: Awaited<ReturnType<typeof resolveAuthSnapshot>>['user'] = null
    let onboardingComplete = false
    let emailVerified = false
    let authLookupDegraded = false
    const shouldResolveAuth = hasAnyAuthCookie(request)

    if (shouldResolveAuth) {
        const startedAt = Date.now()
        const authResolution = await resolveAuthSnapshot(supabase)

        if (authResolution.error) {
            const message = toAuthErrorMessage(authResolution.error)
            const failureKind = classifyAuthLookupError(authResolution.error)

            logger.metric('auth.middleware.snapshot.error', {
                requestId,
                path: pathname,
                message,
                failureKind,
                durationMs: Date.now() - startedAt,
                routeClass,
                phase: hardeningPhase,
            })

            if (failureKind === 'invalid_token') {
                const clearedCookies = clearAuthCookies(request, supabaseResponse)
                logger.metric('auth.middleware.cookie_clear', {
                    requestId,
                    path: pathname,
                    reason: 'invalid_token',
                    clearedCookies,
                    routeClass,
                    phase: hardeningPhase,
                })
            } else if (AUTH_DEGRADED_MODE_ENABLED) {
                authLookupDegraded = true
                logger.metric('auth.redirect.degraded_mode', {
                    requestId,
                    path: pathname,
                    phase: 'snapshot',
                    failureKind,
                    routeClass,
                    hardeningPhase,
                })
            }

            if (shouldLogAuthWarning(Date.now())) {
                logger.warn('[middleware] auth snapshot verification failed', {
                    requestId,
                    path: pathname,
                    failureKind,
                    message,
                    routeClass,
                })
            }
        } else {
            user = authResolution.user
            onboardingComplete = authResolution.snapshot?.onboardingComplete ?? false
            emailVerified = authResolution.snapshot?.emailVerified ?? false
            logger.metric('auth.middleware.snapshot.success', {
                requestId,
                path: pathname,
                durationMs: Date.now() - startedAt,
                routeClass,
                phase: hardeningPhase,
            })
        }
    }

    const url = request.nextUrl.clone()
    const onboardingCompleteCookie = user ? request.cookies.get(`onboarding_complete_${user.id}`)?.value === 'true' : false
    if (onboardingCompleteCookie) {
        onboardingComplete = true
    }

    const shouldVerifyOnboardingFromProfile =
        Boolean(user)
        && emailVerified
        && !onboardingComplete
        && (
            isProtectedAppRoute(pathname)
            || isOnboardingRoute(pathname)
            || isAuthOnlyRoute(pathname)
            || pathname === '/'
            || pathname === '/verify-email'
        )

    if (shouldVerifyOnboardingFromProfile && user) {
        onboardingComplete = await resolveProfileOnboardingComplete(supabase, {
            userId: user.id,
            requestId,
            pathname,
            routeClass,
        })
        if (onboardingComplete) {
            supabaseResponse.cookies.set({
                name: `onboarding_complete_${user.id}`,
                value: 'true',
                httpOnly: true,
                sameSite: 'lax',
                secure: process.env.NODE_ENV === 'production',
                path: '/',
                maxAge: 60 * 60 * 24 * 365, // 1 year
            })
        }
    }

    if (!user && isProtectedAppRoute(pathname)) {
        if (authLookupDegraded && shouldResolveAuth) {
            return withRequestId(supabaseResponse, requestId, routeClass)
        }

        url.pathname = '/login'
        url.searchParams.set(
            'redirect',
            normalizeAuthNextPath(`${pathname}${request.nextUrl.search}`),
        )
        return redirectWithRequestId(url, requestId, routeClass, supabaseResponse)
    }

    if (!user && isOnboardingRoute(pathname)) {
        if (authLookupDegraded && shouldResolveAuth) {
            return withRequestId(supabaseResponse, requestId, routeClass)
        }

        url.pathname = '/signup'
        return redirectWithRequestId(url, requestId, routeClass, supabaseResponse)
    }

    if (!user && pathname === '/verify-email') {
        if (authLookupDegraded && shouldResolveAuth) {
            return withRequestId(supabaseResponse, requestId, routeClass)
        }

        url.pathname = '/login'
        return redirectWithRequestId(url, requestId, routeClass, supabaseResponse)
    }

    if (user && !emailVerified && pathname !== '/verify-email' && pathname !== '/auth/callback') {
        if (isProtectedAppRoute(pathname) || isOnboardingRoute(pathname)) {
            url.pathname = '/verify-email'
            return redirectWithRequestId(url, requestId, routeClass, supabaseResponse)
        }
    }

    if (user && isAuthOnlyRoute(pathname)) {
        const rawRedirect = request.nextUrl.searchParams.get('redirect')
        const redirectPath = rawRedirect ? normalizeAuthNextPath(rawRedirect) : ''

        if (redirectPath && redirectPath !== '/hub') {
            const redirectUrl = new URL(redirectPath, request.url)
            return redirectWithRequestId(redirectUrl, requestId, routeClass, supabaseResponse)
        }

        url.pathname = !emailVerified
            ? '/verify-email'
            : onboardingComplete
                ? '/hub'
                : '/onboarding'
        return redirectWithRequestId(url, requestId, routeClass, supabaseResponse)
    }

    if (user && pathname === '/verify-email') {
        if (emailVerified) {
            url.pathname = onboardingComplete ? '/hub' : '/onboarding'
            return redirectWithRequestId(url, requestId, routeClass, supabaseResponse)
        }
        return withRequestId(supabaseResponse, requestId, routeClass)
    }

    if (user && isOnboardingRoute(pathname) && onboardingComplete) {
        url.pathname = '/hub'
        return redirectWithRequestId(url, requestId, routeClass, supabaseResponse)
    }

    if (user && isProtectedAppRoute(pathname) && !onboardingComplete) {
        const returnPath = normalizeAuthNextPath(`${pathname}${request.nextUrl.search}`)
        url.pathname = '/onboarding'
        url.search = ''
        if (returnPath !== '/hub' && returnPath !== '/onboarding') {
            url.searchParams.set('next', returnPath)
        }
        return redirectWithRequestId(url, requestId, routeClass, supabaseResponse)
    }

    if (pathname === '/') {
        if (user) {
            url.pathname = !emailVerified ? '/verify-email' : onboardingComplete ? '/hub' : '/onboarding'
        } else if (authLookupDegraded && shouldResolveAuth) {
            return withRequestId(supabaseResponse, requestId, routeClass)
        } else {
            url.pathname = '/login'
        }

        return redirectWithRequestId(url, requestId, routeClass, supabaseResponse)
    }

    return withRequestId(supabaseResponse, requestId, routeClass)
}
