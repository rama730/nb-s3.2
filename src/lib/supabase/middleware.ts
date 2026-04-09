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

function redirectWithRequestId(url: URL, requestId: string, routeClass: string): NextResponse {
    return withRequestId(NextResponse.redirect(url), requestId, routeClass)
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

export async function updateSession(request: NextRequest) {
    const requestId = crypto.randomUUID()
    const pathname = request.nextUrl.pathname
    const routeClass = classifyRoute(pathname)
    const hardeningPhase = getAuthHardeningPhase()
    let supabaseResponse = NextResponse.next({
        request,
    })

    if (pathname.startsWith('/_next')) {
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
                    supabaseResponse = NextResponse.next({
                        request,
                    })
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

    if (!user && isProtectedAppRoute(pathname)) {
        if (authLookupDegraded && shouldResolveAuth) {
            return withRequestId(supabaseResponse, requestId, routeClass)
        }

        url.pathname = '/login'
        url.searchParams.set(
            'redirect',
            normalizeAuthNextPath(`${pathname}${request.nextUrl.search}`),
        )
        return redirectWithRequestId(url, requestId, routeClass)
    }

    if (!user && isOnboardingRoute(pathname)) {
        if (authLookupDegraded && shouldResolveAuth) {
            return withRequestId(supabaseResponse, requestId, routeClass)
        }

        url.pathname = '/signup'
        return redirectWithRequestId(url, requestId, routeClass)
    }

    if (!user && pathname === '/verify-email') {
        if (authLookupDegraded && shouldResolveAuth) {
            return withRequestId(supabaseResponse, requestId, routeClass)
        }

        url.pathname = '/login'
        return redirectWithRequestId(url, requestId, routeClass)
    }

    if (user && !emailVerified && pathname !== '/verify-email' && pathname !== '/auth/callback') {
        if (isProtectedAppRoute(pathname) || isOnboardingRoute(pathname)) {
            url.pathname = '/verify-email'
            return redirectWithRequestId(url, requestId, routeClass)
        }
    }

    if (user && isAuthOnlyRoute(pathname)) {
        url.pathname = !emailVerified
            ? '/verify-email'
            : onboardingComplete
                ? '/hub'
                : '/onboarding'
        return redirectWithRequestId(url, requestId, routeClass)
    }

    if (user && pathname === '/verify-email') {
        if (emailVerified) {
            url.pathname = onboardingComplete ? '/hub' : '/onboarding'
            return redirectWithRequestId(url, requestId, routeClass)
        }
        return withRequestId(supabaseResponse, requestId, routeClass)
    }

    if (user && isOnboardingRoute(pathname) && onboardingComplete) {
        url.pathname = '/hub'
        return redirectWithRequestId(url, requestId, routeClass)
    }

    if (user && isProtectedAppRoute(pathname) && !onboardingComplete) {
        url.pathname = '/onboarding'
        return redirectWithRequestId(url, requestId, routeClass)
    }

    if (pathname === '/') {
        if (user) {
            url.pathname = !emailVerified ? '/verify-email' : onboardingComplete ? '/hub' : '/onboarding'
        } else if (authLookupDegraded && shouldResolveAuth) {
            return withRequestId(supabaseResponse, requestId, routeClass)
        } else {
            url.pathname = '/login'
        }

        return redirectWithRequestId(url, requestId, routeClass)
    }

    return withRequestId(supabaseResponse, requestId, routeClass)
}
