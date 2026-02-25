import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { buildE2EFallbackUser, E2E_AUTH_COOKIE, isE2EAuthFallbackEnabled } from '@/lib/e2e/auth-fallback'

const AUTH_LOOKUP_TIMEOUT_MS = 4000
const PROFILE_LOOKUP_TIMEOUT_MS = 2500
const AUTH_COOKIE_MARKERS = ['auth-token', 'sb-access-token', 'sb-refresh-token']
const LOG_THROTTLE_MS = 60_000
let lastAuthLookupWarnAt = 0
let lastProfileLookupWarnAt = 0

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

function clearAuthCookies(request: NextRequest, response: NextResponse): void {
    const cookieNames = request.cookies.getAll().map((cookie) => cookie.name)
    for (const name of cookieNames) {
        const lowerName = name.toLowerCase()
        if (!lowerName.includes('sb')) continue
        if (!AUTH_COOKIE_MARKERS.some((marker) => lowerName.includes(marker))) continue
        response.cookies.set(name, '', {
            maxAge: 0,
            path: '/',
            expires: new Date(0),
        })
    }
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
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
        return supabaseResponse
    }

    // Get user only when auth cookies exist. This avoids expensive network lookups
    // for clearly signed-out visitors and prevents 4s startup delays on local/dev
    // when Supabase is slow or unreachable.
    let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] | null = null
    const shouldLookupAuth = hasAnyAuthCookie(request)
    if (shouldLookupAuth) {
        try {
            const authResponse = await withTimeout(
                supabase.auth.getUser(),
                AUTH_LOOKUP_TIMEOUT_MS,
                'middleware auth lookup'
            )
            user = authResponse.data.user ?? null
        } catch (authError) {
            const message = authError instanceof Error ? authError.message : 'unknown auth lookup error'
            if (shouldLogAuthWarning(Date.now())) {
                console.warn(`[middleware] auth lookup failed, treating as signed-out: ${message}`)
            }
            user = null
            clearAuthCookies(request, supabaseResponse)
        }
    }

    if (!user && isE2EAuthFallbackEnabled()) {
        const fallbackUserId = request.cookies.get(E2E_AUTH_COOKIE)?.value?.trim()
        if (fallbackUserId) {
            user = buildE2EFallbackUser(fallbackUserId)
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

    // Fallback: check cookie cache, then DB lookup when metadata is stale/missing.
    if (user && !hasCompletedOnboarding) {
        const cookieOnboarded = request.cookies.get('x-onboarded')?.value
        if (cookieOnboarded === '1') {
            hasCompletedOnboarding = true
        } else {
            let profile: { username: string | null } | null = null
            let profileError: { message?: string } | null = null
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
                    console.warn(`[middleware] onboarding fallback lookup failed: ${profileError.message ?? 'unknown profile lookup error'}`)
                }
                hasCompletedOnboarding = false
            } else {
                hasCompletedOnboarding = Boolean(profile?.username)
            }

            if (hasCompletedOnboarding) {
                supabaseResponse.cookies.set('x-onboarded', '1', {
                    maxAge: 3600,
                    path: '/',
                    httpOnly: true,
                    sameSite: 'lax',
                })
            }
        }
    }

    // 1. No user trying to access protected routes -> redirect to login
    if (!user && isProtectedRoute) {
        url.pathname = '/login'
        url.searchParams.set('redirect', request.nextUrl.pathname)
        return NextResponse.redirect(url)
    }

    // 2. No user trying to access onboarding -> redirect to signup
    if (!user && isOnboardingRoute) {
        url.pathname = '/signup'
        return NextResponse.redirect(url)
    }

    // 3. Logged-in user trying to access login/signup -> redirect to hub (or onboarding)
    if (user && isAuthRoute) {
        url.pathname = hasCompletedOnboarding ? '/hub' : '/onboarding'
        return NextResponse.redirect(url)
    }

    // 4. Logged-in user (already onboarded) trying to access onboarding -> redirect to hub
    if (user && isOnboardingRoute && hasCompletedOnboarding) {
        url.pathname = '/hub'
        return NextResponse.redirect(url)
    }

    // 5. Logged-in user (NOT onboarded) trying to access protected routes -> redirect to onboarding
    if (user && isProtectedRoute && !hasCompletedOnboarding) {
        url.pathname = '/onboarding'
        return NextResponse.redirect(url)
    }

    // 6. Root path handling
    if (url.pathname === '/') {
        if (user) {
            url.pathname = hasCompletedOnboarding ? '/hub' : '/onboarding'
        } else {
            url.pathname = '/login'
        }
        return NextResponse.redirect(url)
    }

    const requestId = crypto.randomUUID()
    supabaseResponse.headers.set('x-request-id', requestId)

    return supabaseResponse
}
