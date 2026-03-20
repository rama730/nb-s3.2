type OAuthResultLike = {
    data?: {
        url?: string | null
    } | null
    error?: unknown
} | null

export function continueBrowserOAuthRedirect(result: OAuthResultLike): void {
    const targetUrl = typeof result?.data?.url === 'string'
        ? result.data.url.trim()
        : ''
    if (!targetUrl || typeof window === 'undefined') return
    if (window.location.href === targetUrl) return
    window.location.assign(targetUrl)
}
