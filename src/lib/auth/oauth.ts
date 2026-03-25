type OAuthResultLike = {
    data?: {
        url?: string | null
    } | null
    error?: unknown
} | null

function trimSingleTrailingSlash(path: string) {
    if (path.length > 1 && path.endsWith('/')) {
        return path.slice(0, -1)
    }
    return path
}

function normalizeComparableUrl(url: URL) {
    return `${url.origin}${trimSingleTrailingSlash(url.pathname)}${url.search}${url.hash}`
}

function readTrustedOAuthRedirectOrigins() {
    return new Set(
        (process.env.NEXT_PUBLIC_TRUSTED_OAUTH_REDIRECT_ORIGINS ?? '')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
    )
}

function isAllowedOAuthRedirectTarget(url: URL, currentUrl: URL) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false
    }

    return url.origin === currentUrl.origin || readTrustedOAuthRedirectOrigins().has(url.origin)
}

export function continueBrowserOAuthRedirect(result: OAuthResultLike): void {
    const targetUrl = typeof result?.data?.url === 'string'
        ? result.data.url.trim()
        : ''
    if (!targetUrl || typeof window === 'undefined') return

    const currentUrl = new URL(window.location.href)
    let resolvedTargetUrl: URL

    try {
        resolvedTargetUrl = new URL(targetUrl, currentUrl)
    } catch {
        return
    }

    if (!isAllowedOAuthRedirectTarget(resolvedTargetUrl, currentUrl)) return
    if (normalizeComparableUrl(currentUrl) === normalizeComparableUrl(resolvedTargetUrl)) return
    window.location.assign(resolvedTargetUrl.href)
}
