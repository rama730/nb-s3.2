type VerificationSubject = {
    email_confirmed_at?: unknown
    confirmed_at?: unknown
    email_verified?: unknown
    emailVerified?: unknown
    user_metadata?: Record<string, unknown> | null
    app_metadata?: Record<string, unknown> | null
}

function readBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
        if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
    }
    return null
}

function hasTimestamp(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0
}

export function isEmailVerified(subject: VerificationSubject | null | undefined): boolean {
    if (!subject) return false

    if (hasTimestamp(subject.email_confirmed_at) || hasTimestamp(subject.confirmed_at)) {
        return true
    }

    const topLevel =
        readBoolean(subject.email_verified)
        ?? readBoolean(subject.emailVerified)
    if (topLevel !== null) return topLevel

    const userMetadata = subject.user_metadata || null
    if (userMetadata) {
        const userMetadataValue =
            readBoolean(userMetadata.email_verified)
            ?? readBoolean(userMetadata.emailVerified)
        if (userMetadataValue !== null) return userMetadataValue
        if (hasTimestamp(userMetadata.email_verified_at) || hasTimestamp(userMetadata.emailConfirmedAt)) {
            return true
        }
    }

    const appMetadata = subject.app_metadata || null
    if (appMetadata) {
        const appMetadataValue =
            readBoolean(appMetadata.email_verified)
            ?? readBoolean(appMetadata.emailVerified)
        if (appMetadataValue !== null) return appMetadataValue
    }

    return false
}

