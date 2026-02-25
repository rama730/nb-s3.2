export function isAdminUser(user: { id: string; app_metadata?: Record<string, unknown> } | null | undefined): boolean {
    if (!user) return false

    const role = typeof user.app_metadata?.role === 'string' ? user.app_metadata.role : ''
    if (role === 'admin' || role === 'service_role') return true

    const adminIds = (process.env.ADMIN_USER_IDS || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    return adminIds.includes(user.id)
}
