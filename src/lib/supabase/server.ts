import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { buildE2EFallbackUser, E2E_AUTH_COOKIE, isE2EAuthFallbackEnabled } from '@/lib/e2e/auth-fallback'

const SERVER_AUTH_LOOKUP_TIMEOUT_MS = 3500
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
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
        if (timedOut) {
            void basePromise.catch(() => undefined)
        }
    }
}

export async function createClient() {
    const cookieStore = await cookies()

    const client = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
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
    const wrappedGetUser = async () => {
        const fallbackUserId = isE2EAuthFallbackEnabled()
            ? cookieStore.get(E2E_AUTH_COOKIE)?.value?.trim()
            : null
        if (fallbackUserId) {
            return {
                data: { user: buildE2EFallbackUser(fallbackUserId) },
                error: null,
            }
        }

        // Signed-out requests should not block on network auth lookups.
        if (!hasAnyAuthCookie(cookieStore)) {
            return {
                data: { user: null },
                error: null,
            }
        }

        try {
            return await withTimeout(
                originalGetUser(),
                SERVER_AUTH_LOOKUP_TIMEOUT_MS,
                'server auth lookup'
            )
        } catch (authError) {
            const message = authError instanceof Error ? authError.message : 'Auth lookup failed'
            return {
                data: { user: null },
                error: {
                    name: 'AuthError',
                    message,
                    status: 503,
                },
            }
        }
    }
    ;(client.auth as { getUser: typeof wrappedGetUser }).getUser = wrappedGetUser

    return client
}

export const createSupabaseServerClient = createClient

export async function createAdminClient() {
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
            cookies: {
                getAll() { return [] },
                setAll() { }
            }
        }
    )
}
