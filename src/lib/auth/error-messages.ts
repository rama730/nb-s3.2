export function resolveAuthPageErrorMessage(code: string | null | undefined): string | null {
    switch ((code || '').trim()) {
        case 'auth-code-error':
            return 'Google sign-in could not be completed. Try again. If you are developing locally, open the app on the same origin you started from.'
        default:
            return null
    }
}
