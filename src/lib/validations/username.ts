const USERNAME_PATTERN = /^[a-z0-9_]+$/

export const CORE_RESERVED_USERNAMES = [
    'admin',
    'edge',
    'api',
    'www',
    'mail',
    'support',
    'help',
    'settings',
    'profile',
    'login',
    'signup',
    'auth',
    'onboarding',
] as const

export const RESERVED_USERNAMES = CORE_RESERVED_USERNAMES

export type UsernameValidationResult = {
    valid: boolean
    message: string
}

export function normalizeUsername(value: string): string {
    return value
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim()
        .toLowerCase()
}

export function sanitizeUsernameInput(value: string): string {
    return normalizeUsername(value).replace(/[^a-z0-9_]/g, '').slice(0, 20)
}

export function isReservedUsername(username: string): boolean {
    const normalized = username.trim().normalize('NFC').toLowerCase()
    return CORE_RESERVED_USERNAMES.includes(normalized as (typeof CORE_RESERVED_USERNAMES)[number])
}

export function validateUsername(username: string): UsernameValidationResult {
    const normalized = normalizeUsername(username)

    if (!normalized || normalized.length < 3) {
        return { valid: false, message: 'Username must be at least 3 characters' }
    }

    if (normalized.length > 20) {
        return { valid: false, message: 'Username must be 20 characters or less' }
    }

    if (!USERNAME_PATTERN.test(normalized)) {
        return {
            valid: false,
            message: 'Only lowercase letters, numbers, and underscores allowed',
        }
    }

    return { valid: true, message: 'Looks good!' }
}
