import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

    // Get user
    const {
        data: { user },
    } = await supabase.auth.getUser()

    const url = request.nextUrl.clone()

    // Route definitions
    const protectedPaths = ['/hub', '/settings', '/messages', '/profile', '/monitor']
    const authPaths = ['/login', '/signup'] // Paths only for unauthenticated users
    const onboardingPath = '/onboarding'

    const isProtectedRoute = protectedPaths.some(path => url.pathname.startsWith(path))
    const isAuthRoute = authPaths.some(path => url.pathname.startsWith(path))
    const isOnboardingRoute = url.pathname.startsWith(onboardingPath)

    // Check if user has completed onboarding (username exists means onboarded)
    const hasCompletedOnboarding = user?.user_metadata?.username || user?.user_metadata?.onboarded

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

    return supabaseResponse
}
