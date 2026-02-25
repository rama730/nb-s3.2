export const ROUTES = {
    HOME: '/',
    LOGIN: '/login',
    SIGNUP: '/signup',
    ONBOARDING: '/onboarding',
    WORKSPACE: '/workspace',
    HUB: '/hub',
    PEOPLE: '/people',
    MESSAGES: '/messages',
    PROJECTS: '/projects',
    SETTINGS: '/settings',
    PROFILE: '/profile',
} as const

export const API_ROUTES = {
    HEALTH: '/api/health',
    PROJECTS: '/api/v1/projects',
    USERNAME_CHECK: '/api/onboarding/username-check',
    ACCOUNT_DELETE: '/api/v1/account/delete',
    RESERVED_USERNAMES: '/api/v1/account/reserved-usernames',
    INNGEST: '/api/inngest',
    CLEANUP_ORPHAN: '/api/cleanup-orphan',
} as const
