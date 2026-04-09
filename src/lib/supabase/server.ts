import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { resolveAuthSnapshot, type AuthSnapshotResolution } from '@/lib/auth/snapshot'
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
    const cookieStore = await cookies()
    const env = resolveSupabasePublicEnv('supabase.server')

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
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
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
            authResolutionPromise = resolveAuthSnapshot(client)
        }
        return authResolutionPromise
    }

    const wrappedGetUser = async () => {
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
