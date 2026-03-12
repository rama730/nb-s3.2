import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { logger } from '@/lib/logger'
import { normalizeAuthNextPath } from '@/lib/auth/redirects'
import { getAuthHardeningPhase } from '@/lib/auth/hardening'
import { classifyAuthLookupError, toAuthErrorMessage } from '@/lib/auth/session-lookup'
import { resolveSupabasePublicEnv } from '@/lib/supabase/env'

const MAX_TIMEOUT_MS = 15_000
const AUTH_LOOKUP_TIMEOUT_MS = readTimeoutFromEnv('AUTH_MIDDLEWARE_LOOKUP_TIMEOUT_MS', 4000)
const PROFILE_LOOKUP_TIMEOUT_MS = readTimeoutFromEnv('AUTH_MIDDLEWARE_PROFILE_TIMEOUT_MS', 2500)
const AUTH_DEGRADED_MODE_ENABLED = readBooleanFromEnv('AUTH_DEGRADED_MODE_ENABLED', true)
const AUTH_COOKIE_MARKERS = ['auth-token', 'sb-access-token', 'sb-refresh-token']
const LOG_THROTTLE_MS = 60_000
let lastAuthLookupWarnAt = 0
let lastProfileLookupWarnAt = 0

function readTimeoutFromEnv(name: string, fallback: number): number {
    const raw = process.env[name]
    if (!raw) return fallback
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(MAX_TIMEOUT_MS, Math.max(250, parsed))
}

function readBooleanFromEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name]
    if (!raw) return fallback
    const value = raw.trim().toLowerCase()
    if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true
    if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false
    return fallback
}

function withRequestId(response: NextResponse, requestId: string): NextResponse {
    response.headers.set('x-request-id', requestId)
    return response
}

function redirectWithRequestId(url: URL, requestId: string): NextResponse {
    return withRequestId(NextResponse.redirect(url), requestId)
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

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> {
    const basePromise = Promise.resolve(promise)
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    try {
        return await Promise.race([
            basePromise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => {
                    timedOut = true
                    reject(new Error(`${label} timed out after ${timeoutMs}ms`))
                }, timeoutMs)
            }),
        ])
    } finally {
        if (timer) clearTimeout(timer)
        // If timeout won the race, the original promise may still reject later.
        // Attach a noop catch to avoid unhandled rejection noise in Node logs.
        if (timedOut) {
            void basePromise.catch(() => undefined)
        }
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
    if (now - lastAuthLookupWarnAt < LOG_THROTTLE_MS) return false
    lastAuthLookupWarnAt = now
    return true
}

function shouldLogProfileWarning(now: number): boolean {
    if (now - lastProfileLookupWarnAt < LOG_THROTTLE_MS) return false
    lastProfileLookupWarnAt = now
    return true
}

export async function updateSession(request: NextRequest) {
    const requestId = crypto.randomUUID()
    const hardeningPhase = getAuthHardeningPhase()
    let supabaseResponse = NextResponse.next({
        request,
    })
    let supabaseEnv: { url: string; anonKey: string }
    try {
        supabaseEnv = resolveSupabasePublicEnv('supabase.middleware')
    } catch (error) {
        logger.error('[middleware] supabase config missing', {
            requestId,
            path: request.nextUrl.pathname,
            error: error instanceof Error ? error.message : String(error),
        })
        return withRequestId(
            NextResponse.json({ error: 'Server configuration error' }, { status: 500 }),
            requestId
        )
    }

    const supabase = createServerClient(
        supabaseEnv.url,
        supabaseEnv.anonKey,
        {
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

    // Skip middleware for static files
    if (request.nextUrl.pathname.startsWith('/_next')) {
        return withRequestId(supabaseResponse, requestId)
    }

    // Get user only when auth cookies exist. This avoids expensive network lookups
    // for clearly signed-out visitors and prevents startup delays when Supabase is
    // temporarily slow or unreachable.
    let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] | null = null
    const shouldLookupAuth = hasAnyAuthCookie(request)
    let authLookupDegraded = false
    if (shouldLookupAuth) {
        const authLookupStartedAt = Date.now()
        try {
            const authResponse = await withTimeout(
                supabase.auth.getUser(),
                AUTH_LOOKUP_TIMEOUT_MS,
                'middleware auth lookup'
            )
            user = authResponse.data.user ?? null
            logger.metric('auth.middleware.lookup.success', {
                requestId,
                path: request.nextUrl.pathname,
                durationMs: Date.now() - authLookupStartedAt,
                phase: hardeningPhase,
            })
        } catch (authError) {
            const now = Date.now()
            const message = toAuthErrorMessage(authError)
            const failureKind = classifyAuthLookupError(authError)

            if (failureKind === 'timeout') {
                logger.metric('auth.middleware.lookup.timeout', {
                    requestId,
                    path: request.nextUrl.pathname,
                    message,
                    durationMs: Date.now() - authLookupStartedAt,
                    phase: hardeningPhase,
                })
            } else {
                logger.metric('auth.middleware.lookup.error', {
                    requestId,
                    path: request.nextUrl.pathname,
                    message,
                    failureKind,
                    durationMs: Date.now() - authLookupStartedAt,
                    phase: hardeningPhase,
                })
            }

            if (failureKind === 'invalid_token') {
                const clearedCookies = clearAuthCookies(request, supabaseResponse)
                logger.metric('auth.middleware.cookie_clear', {
                    requestId,
                    path: request.nextUrl.pathname,
                    reason: 'invalid_token',
                    clearedCookies,
                    phase: hardeningPhase,
                })
            } else if (AUTH_DEGRADED_MODE_ENABLED) {
                // Degraded mode: preserve cookies and avoid destructive redirects.
                authLookupDegraded = true
                logger.metric('auth.redirect.degraded_mode', {
                    requestId,
                    path: request.nextUrl.pathname,
                    phase: 'lookup',
                    failureKind,
                    hardeningPhase,
                })
            } else {
                logger.metric('auth.middleware.lookup.error', {
                    requestId,
                    path: request.nextUrl.pathname,
                    message,
                    failureKind: 'degraded_mode_disabled',
                    durationMs: Date.now() - authLookupStartedAt,
                    phase: hardeningPhase,
                })
            }

            if (shouldLogAuthWarning(now)) {
                logger.warn('[middleware] auth lookup failed', {
                    requestId,
                    path: request.nextUrl.pathname,
                    failureKind,
                    message,
                })
            }
            user = null
        }
    }

    const url = request.nextUrl.clone()

    // Route definitions
    const protectedPaths = ['/hub', '/settings', '/messages', '/profile', '/people', '/workspace', '/monitor']
    const authPaths = ['/login', '/signup'] // Paths only for unauthenticated users
    const onboardingPath = '/onboarding'

    const isProtectedRoute = protectedPaths.some(path => url.pathname.startsWith(path))
    const isAuthRoute = authPaths.some(path => url.pathname.startsWith(path))
    const isOnboardingRoute = url.pathname.startsWith(onboardingPath)

    // Check if user has completed onboarding. JWT metadata is the fast path.
    let hasCompletedOnboarding = Boolean(user?.user_metadata?.username || user?.user_metadata?.onboarded)
    let onboardingStatusUnknown = false

    // Fallback to profile lookup when metadata is stale/missing.
    if (user && !hasCompletedOnboarding) {
        let profile: { username: string | null } | null = null
        let profileError: { message?: string } | null = null
        const profileLookupStartedAt = Date.now()
        try {
            const profileResponse = await withTimeout(
                supabase
                    .from('profiles')
                    .select('username')
                    .eq('id', user.id)
                    .maybeSingle() as PromiseLike<{
                        data: { username: string | null } | null
                        error: { message?: string } | null
                    }>,
                PROFILE_LOOKUP_TIMEOUT_MS,
                'middleware profile lookup'
            )
            profile = profileResponse.data
            profileError = profileResponse.error
        } catch (lookupError) {
            profileError = {
                message: lookupError instanceof Error ? lookupError.message : 'profile lookup timeout',
            }
        }

        if (profileError) {
            if (shouldLogProfileWarning(Date.now())) {
                logger.warn('[middleware] onboarding fallback lookup failed', {
                    requestId,
                    path: request.nextUrl.pathname,
                    message: profileError.message ?? 'unknown profile lookup error',
                    durationMs: Date.now() - profileLookupStartedAt,
                })
            }
            onboardingStatusUnknown = true
            hasCompletedOnboarding = false
        } else {
            hasCompletedOnboarding = Boolean(profile?.username)
        }
    }

    // 1. No user trying to access protected routes -> redirect to login
    if (!user && isProtectedRoute) {
        if (authLookupDegraded && shouldLookupAuth) {
            logger.metric('auth.redirect.degraded_mode', {
                requestId,
                path: request.nextUrl.pathname,
                phase: 'route_guard',
                routeType: 'protected',
                hardeningPhase,
            })
            return withRequestId(supabaseResponse, requestId)
        }
        url.pathname = '/login'
        url.searchParams.set(
            'redirect',
            normalizeAuthNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`),
        )
        return redirectWithRequestId(url, requestId)
    }

    // 2. No user trying to access onboarding -> redirect to signup
    if (!user && isOnboardingRoute) {
        if (authLookupDegraded && shouldLookupAuth) {
            logger.metric('auth.redirect.degraded_mode', {
                requestId,
                path: request.nextUrl.pathname,
                phase: 'route_guard',
                routeType: 'onboarding',
                hardeningPhase,
            })
            return withRequestId(supabaseResponse, requestId)
        }
        url.pathname = '/signup'
        return redirectWithRequestId(url, requestId)
    }

    // 3. Logged-in user trying to access login/signup -> redirect to hub (or onboarding)
    if (user && isAuthRoute) {
        const authRouteRedirectPath = onboardingStatusUnknown || hasCompletedOnboarding
            ? '/hub'
            : '/onboarding'
        url.pathname = authRouteRedirectPath
        return redirectWithRequestId(url, requestId)
    }

    // 4. Logged-in user (already onboarded) trying to access onboarding -> redirect to hub
    if (user && isOnboardingRoute && hasCompletedOnboarding) {
        url.pathname = '/hub'
        return redirectWithRequestId(url, requestId)
    }

    // 5. Logged-in user (NOT onboarded) trying to access protected routes -> redirect to onboarding
    if (user && isProtectedRoute && !hasCompletedOnboarding) {
        if (onboardingStatusUnknown) {
            logger.metric('auth.redirect.degraded_mode', {
                requestId,
                path: request.nextUrl.pathname,
                phase: 'onboarding_lookup',
                routeType: 'protected',
                hardeningPhase,
            })
            return withRequestId(supabaseResponse, requestId)
        }
        url.pathname = '/onboarding'
        return redirectWithRequestId(url, requestId)
    }

    // 6. Root path handling
    if (url.pathname === '/') {
        if (user) {
            const rootRedirectPath = onboardingStatusUnknown || hasCompletedOnboarding
                ? '/hub'
                : '/onboarding'
            url.pathname = rootRedirectPath
        } else if (authLookupDegraded && shouldLookupAuth) {
            logger.metric('auth.redirect.degraded_mode', {
                requestId,
                path: request.nextUrl.pathname,
                phase: 'root',
                routeType: 'root',
                hardeningPhase,
            })
            return withRequestId(supabaseResponse, requestId)
        } else {
            url.pathname = '/login'
        }
        return redirectWithRequestId(url, requestId)
    }

    return withRequestId(supabaseResponse, requestId)
}
