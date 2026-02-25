export type OnboardingErrorCode =
    | 'NOT_AUTHENTICATED'
    | 'INVALID_INPUT'
    | 'RATE_LIMITED'
    | 'USERNAME_TAKEN'
    | 'USERNAME_INVALID'
    | 'USERNAME_RESERVED'
    | 'DRAFT_CONFLICT'
    | 'SUBMISSION_IN_PROGRESS'
    | 'DB_ERROR'
    | 'CLAIMS_SYNC_FAILED'
    | 'UNKNOWN'

export type OnboardingError = {
    code: OnboardingErrorCode
    message: string
    retryable?: boolean
}

export function onboardingError(
    code: OnboardingErrorCode,
    message: string,
    retryable = false
): OnboardingError {
    return { code, message, retryable }
}
