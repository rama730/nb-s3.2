import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import { resolveAuthSnapshot, type AuthSnapshotResolution } from '@/lib/auth/snapshot'
import { logger } from '@/lib/logger'
import { toPrivacySafeRouteMetric } from '@/lib/routing/route-metric'
import { classifyRoute } from '@/lib/routing/route-class'
import { resolveSupabasePublicEnv, resolveSupabaseServiceEnv } from '@/lib/supabase/env'
import { resolveSupabaseServerCookieOptions } from '@/lib/supabase/cookie-options'

const AUTH_COOKIE_MARKERS = ['auth-token', 'sb-access-token', 'sb-refresh-token']

function hasAnyAuthCookie(
    cookieStore: {
        getAll: () => Array<{ name: string }>
    }
): boolean {
    const allCookies = cookieStore.getAll()
    for (const cookie of allCookies) {
        const name = cookie.name.toLowerCase()
        if (!name.includes('sb')) continue
        if (AUTH_COOKIE_MARKERS.some((marker) => name.includes(marker))) return true
    }
    return false
}

type AuthSnapshotAwareClient = Awaited<ReturnType<typeof createServerClient>> & {
    __resolveAuthSnapshot?: () => Promise<AuthSnapshotResolution>
    __getUserFromAuthServer?: (jwt?: string) => Promise<{
        data: { user: User | null }
        error: { message?: string; status?: number } | null
    }>
}

export async function createClient() {
    let cookieStore: {
        getAll: () => any[];
        set?: (name: string, value: string, options: any) => void;
    }
    try {
        cookieStore = await cookies()
    } catch {
        cookieStore = { getAll: () => [] }
    }
    const env = resolveSupabasePublicEnv('supabase.server')

    let route = '/unknown'
    try {
        const requestHeaders = await headers()
        route = toPrivacySafeRouteMetric(
            requestHeaders.get('x-route-metric')
                ?? requestHeaders.get('x-matched-path')
                ?? requestHeaders.get('next-url'),
        )
    } catch {
        // Server utilities and tests may execute without a Next request scope.
    }

    const client = createServerClient(
        env.url,
        env.anonKey,
        {
            cookieOptions: resolveSupabaseServerCookieOptions(),
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) => {
                            if (cookieStore.set) {
                                cookieStore.set(name, value, options)
                            }
                        })
                    } catch {
                        // The `setAll` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing sessions.
                    }
                },
            },
        }
    )
    const originalGetUser = client.auth.getUser.bind(client.auth)

    let authResolutionPromise: Promise<AuthSnapshotResolution> | null = null
    const resolveClientAuthSnapshot = () => {
        if (!authResolutionPromise) {
            const startedAt = Date.now()
            authResolutionPromise = resolveAuthSnapshot(client).then((resolution) => {
                logger.metric('auth.server.resolution', {
                    module: 'auth',
                    route,
                    scope: classifyRoute(route),
                    outcome: resolution.error
                        ? 'error'
                        : resolution.user
                            ? 'authenticated'
                            : 'anonymous',
                    durationMs: Date.now() - startedAt,
                    value: 1,
                })
                return resolution
            }).catch((error) => {
                logger.metric('auth.server.resolution', {
                    module: 'auth',
                    route,
                    scope: classifyRoute(route),
                    outcome: 'threw',
                    durationMs: Date.now() - startedAt,
                    value: 1,
                })
                throw error
            })
        }
        return authResolutionPromise
    }

    const wrappedGetUser = async () => {
        if (process.env.MOCK_USER_ID) {
            return {
                data: { user: { id: process.env.MOCK_USER_ID } as any },
                error: null,
            }
        }
        if (!hasAnyAuthCookie(cookieStore)) {
            return {
                data: { user: null },
                error: null,
            }
        }

        const resolution = await resolveClientAuthSnapshot()
        return {
            data: {
                user: resolution.user,
            },
            error: resolution.error,
        }
    }
    ;(client.auth as { getUser: typeof wrappedGetUser }).getUser = wrappedGetUser
    ;(client as AuthSnapshotAwareClient).__resolveAuthSnapshot = resolveClientAuthSnapshot
    ;(client as AuthSnapshotAwareClient).__getUserFromAuthServer = originalGetUser

    return client
}

export const createSupabaseServerClient = createClient

export async function createAdminClient() {
    const env = resolveSupabaseServiceEnv('supabase.admin')
    return createServerClient(
        env.url,
        env.serviceRoleKey,
        {
            cookieOptions: resolveSupabaseServerCookieOptions(),
            cookies: {
                getAll() { return [] },
                setAll() { }
            }
        }
    )
}
