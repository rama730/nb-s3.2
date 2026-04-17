// SEC-H13: this helper reads `ADMIN_USER_IDS` from `process.env`, which is
// stripped from client bundles by Next.js because it lacks the
// `NEXT_PUBLIC_` prefix. If any future caller accidentally imports this
// module from a `"use client"` file, the bundler would silently substitute
// `process.env.ADMIN_USER_IDS` with `undefined` and the function would
// always return `false` for env-listed admins. The `typeof window` guard
// below turns that silent failure into a loud error at runtime so the
// regression is caught in development instead of in production.
export function isAdminUser(user: { id: string; app_metadata?: Record<string, unknown> } | null | undefined): boolean {
    if (typeof window !== 'undefined') {
        // eslint-disable-next-line no-console
        console.error('[security] isAdminUser() must never run in the browser. Refusing.')
        return false
    }

    if (!user) return false
    const userId = typeof user.id === 'string' ? user.id.trim() : ''
    if (!userId) return false

    const role = typeof user.app_metadata?.role === 'string' ? user.app_metadata.role : ''
    if (role === 'admin' || role === 'service_role') return true

    const adminIds = (process.env.ADMIN_USER_IDS || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    return adminIds.includes(userId)
}
