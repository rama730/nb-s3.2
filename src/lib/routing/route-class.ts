export type RouteClass = 'public_cached' | 'user_shell' | 'active_surface'

type RouteDescriptor = {
    pathname: string
    routeClass: RouteClass
}

type SpecialRouteDescriptor = {
    routeClass: RouteClass
    protected: boolean
    matches: (pathname: string) => boolean
}

const ACTIVE_SURFACE_ROUTES: RouteDescriptor[] = [
    { pathname: '/messages', routeClass: 'active_surface' },
    { pathname: '/workspace', routeClass: 'active_surface' },
]

const USER_SHELL_ROUTES: RouteDescriptor[] = [
    { pathname: '/hub', routeClass: 'user_shell' },
    { pathname: '/settings', routeClass: 'user_shell' },
    { pathname: '/profile', routeClass: 'user_shell' },
    { pathname: '/people', routeClass: 'user_shell' },
    { pathname: '/monitor', routeClass: 'user_shell' },
    { pathname: '/onboarding', routeClass: 'user_shell' },
    { pathname: '/authorize', routeClass: 'user_shell' },
]

const PUBLIC_CACHED_ROUTES: RouteDescriptor[] = [
    { pathname: '/', routeClass: 'public_cached' },
    { pathname: '/login', routeClass: 'public_cached' },
    { pathname: '/signup', routeClass: 'public_cached' },
    { pathname: '/forgot-password', routeClass: 'public_cached' },
    { pathname: '/reset-password', routeClass: 'public_cached' },
    { pathname: '/verify-email', routeClass: 'public_cached' },
]

const ALL_ROUTES = [...ACTIVE_SURFACE_ROUTES, ...USER_SHELL_ROUTES, ...PUBLIC_CACHED_ROUTES]

const SPECIAL_ROUTES: SpecialRouteDescriptor[] = [
    {
        routeClass: 'user_shell',
        protected: true,
        matches: (pathname) => pathname === '/projects/new' || pathname.startsWith('/projects/new/'),
    },
    {
        routeClass: 'user_shell',
        protected: false,
        matches: (pathname) => /^\/projects\/[^/]+\/sprints\/[^/]+(?:\/|$)/.test(pathname),
    },
    {
        routeClass: 'user_shell',
        protected: true,
        matches: (pathname) => pathname === '/admin/notifications' || pathname.startsWith('/admin/notifications/'),
    },
]

function matchesRoutePrefix(pathname: string, routePath: string) {
    if (routePath === '/') return pathname === '/'
    return pathname === routePath || pathname.startsWith(`${routePath}/`)
}

export function classifyRoute(pathname: string): RouteClass {
    const specialMatch = SPECIAL_ROUTES.find((route) => route.matches(pathname))
    if (specialMatch) return specialMatch.routeClass

    const match = ALL_ROUTES.find((route) => matchesRoutePrefix(pathname, route.pathname))
    return match?.routeClass ?? 'public_cached'
}

export function isProtectedAppRoute(pathname: string) {
    const specialMatch = SPECIAL_ROUTES.find((route) => route.matches(pathname))
    if (specialMatch) return specialMatch.protected

    return ACTIVE_SURFACE_ROUTES.some((route) => matchesRoutePrefix(pathname, route.pathname))
        || USER_SHELL_ROUTES.some((route) => matchesRoutePrefix(pathname, route.pathname) && route.pathname !== '/onboarding')
}

export function isAuthOnlyRoute(pathname: string) {
    return pathname === '/login' || pathname === '/signup' || pathname === '/forgot-password'
}

export function isOnboardingRoute(pathname: string) {
    return pathname === '/onboarding' || pathname.startsWith('/onboarding/')
}
