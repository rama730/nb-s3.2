export const DEFAULT_AUTH_NEXT_PATH = '/hub';
const DEFAULT_LOCAL_ORIGIN = 'http://localhost:3000';
const MISSING_CANONICAL_BASE_ERROR =
    '[auth.redirects] missing APP_URL/NEXT_PUBLIC_APP_URL in production runtime';

export type ResolveAuthBaseUrlOptions = {
    appUrl?: string | null;
    publicAppUrl?: string | null;
    requestUrl?: string | null;
    browserOrigin?: string | null;
    defaultLocalOrigin?: string;
    requireConfiguredBaseInProduction?: boolean;
};

function canonicalizeLocalHost(url: URL): URL {
    if (url.hostname === '0.0.0.0' || url.hostname === '127.0.0.1') {
        url.hostname = 'localhost';
    }
    return url;
}

function toOrigin(raw: string | null | undefined): string | null {
    if (!raw || typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value) return null;
    try {
        const parsed = canonicalizeLocalHost(new URL(value));
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        parsed.pathname = '/';
        parsed.search = '';
        parsed.hash = '';
        return parsed.origin;
    } catch {
        return null;
    }
}

function toOriginFromRequestUrl(raw: string | null | undefined): string | null {
    if (!raw || typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value) return null;
    try {
        const parsed = canonicalizeLocalHost(new URL(value));
        return parsed.origin;
    } catch {
        return null;
    }
}

function getWindowOrigin(): string | null {
    if (typeof window === 'undefined') return null;
    return toOrigin(window.location.origin);
}

export function resolveAuthBaseUrl(options: ResolveAuthBaseUrlOptions = {}): string {
    const appUrl = options.appUrl ?? process.env.APP_URL;
    const publicAppUrl = options.publicAppUrl ?? process.env.NEXT_PUBLIC_APP_URL;
    const configuredOrigin = toOrigin(appUrl) ?? toOrigin(publicAppUrl);
    const requestOrigin = toOriginFromRequestUrl(options.requestUrl);
    const browserOrigin = toOrigin(options.browserOrigin) ?? getWindowOrigin();
    const fallbackOrigin = toOrigin(options.defaultLocalOrigin) ?? DEFAULT_LOCAL_ORIGIN;
    const requireConfiguredBaseInProduction = options.requireConfiguredBaseInProduction ?? true;
    const isProductionRuntime = process.env.NODE_ENV === 'production';

    if (configuredOrigin) return configuredOrigin;

    if (isProductionRuntime && requireConfiguredBaseInProduction) {
        throw new Error(MISSING_CANONICAL_BASE_ERROR);
    }

    return requestOrigin ?? browserOrigin ?? fallbackOrigin;
}

export function normalizeAuthNextPath(
    value: string | null | undefined,
    fallback: string = DEFAULT_AUTH_NEXT_PATH,
): string {
    const fallbackPath = normalizeAuthNextFallback(fallback);
    if (!value || typeof value !== 'string') return fallbackPath;

    const raw = value.trim();
    if (!raw) return fallbackPath;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return fallbackPath;
    if (!raw.startsWith('/')) return fallbackPath;
    if (raw.startsWith('//')) return fallbackPath;

    try {
        const parsed = new URL(raw, 'http://local.test');
        if (parsed.origin !== 'http://local.test') return fallbackPath;
        if (parsed.pathname === '/auth/callback') return fallbackPath;
        const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        return normalized || fallbackPath;
    } catch {
        return fallbackPath;
    }
}

function normalizeAuthNextFallback(value: string): string {
    if (!value.startsWith('/')) return DEFAULT_AUTH_NEXT_PATH;
    if (value.startsWith('//')) return DEFAULT_AUTH_NEXT_PATH;
    return value;
}

export function buildOAuthRedirectTo(
    baseUrl: string,
    nextPath: string | null | undefined,
    requestId?: string | null,
): string {
    const normalizedNext = normalizeAuthNextPath(nextPath);
    const callbackUrl = new URL('/auth/callback', resolveAuthBaseUrl({ appUrl: baseUrl }));
    callbackUrl.searchParams.set('next', normalizedNext);
    if (requestId && typeof requestId === 'string' && requestId.trim().length > 0) {
        callbackUrl.searchParams.set('rid', requestId.trim());
    }
    return callbackUrl.toString();
}

export function resolveAuthRedirectPath(value: string | null | undefined): string {
    return normalizeAuthNextPath(value);
}

export function buildAuthPageHref(pathname: '/login' | '/signup', redirectPath: string): string {
    const normalizedRedirect = normalizeAuthNextPath(redirectPath);
    if (normalizedRedirect === DEFAULT_AUTH_NEXT_PATH) return pathname;
    return `${pathname}?redirect=${encodeURIComponent(normalizedRedirect)}`;
}
