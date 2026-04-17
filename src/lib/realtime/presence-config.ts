const DEFAULT_LOCAL_PRESENCE_PORT = 4010

function normalizePresenceUrl(value: string | null | undefined) {
    const trimmed = value?.trim()
    if (!trimmed) return null
    return trimmed.replace(/\/$/, '')
}

function isLocalHostname(hostname: string | null | undefined) {
    if (!hostname) return false
    return hostname === 'localhost' || hostname === '127.0.0.1'
}

function hasDisabledPlaceholderHostname(value: string | null | undefined) {
    if (!value) return false
    try {
        const parsed = new URL(value)
        return parsed.hostname.endsWith('.invalid')
    } catch {
        return false
    }
}

export function resolvePresenceWebSocketUrl(params?: {
    preferredUrl?: string | null
    hostname?: string | null
    env?: NodeJS.ProcessEnv
}) {
    const env = params?.env ?? process.env
    const isProduction = env.NODE_ENV === 'production'
    const preferred = normalizePresenceUrl(params?.preferredUrl)
    if (preferred) {
        if (hasDisabledPlaceholderHostname(preferred)) {
            if (isProduction) {
                return null
            }
        } else {
            if (isProduction && !preferred.startsWith('wss://')) {
                throw new Error('Presence websocket URLs must use wss:// in production')
            }
            return preferred
        }
    }

    const configured = normalizePresenceUrl(
        env.NEXT_PUBLIC_PRESENCE_WS_URL
        || env.PRESENCE_WS_URL
        || null,
    )
    if (configured) {
        if (hasDisabledPlaceholderHostname(configured)) {
            if (isProduction) {
                return null
            }
        } else {
            if (isProduction && !configured.startsWith('wss://')) {
                throw new Error('Presence websocket URLs must use wss:// in production')
            }
            return configured
        }
    }

    const explicitPort = Number(env.PRESENCE_SERVICE_PORT || DEFAULT_LOCAL_PRESENCE_PORT)
    const port = Number.isFinite(explicitPort) && explicitPort > 0 ? explicitPort : DEFAULT_LOCAL_PRESENCE_PORT
    const hostname = params?.hostname ?? null
    if (!isProduction || isLocalHostname(hostname)) {
        return `ws://127.0.0.1:${port}/ws`
    }

    return null
}
