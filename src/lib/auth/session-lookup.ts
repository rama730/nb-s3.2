export type AuthLookupFailureKind = 'timeout' | 'invalid_token' | 'transient';

const INVALID_TOKEN_MARKERS = [
    'invalid jwt',
    'jwt expired',
    'token has expired',
    'refresh token not found',
    'refresh_token_not_found',
    'invalid refresh token',
    'session not found',
    'auth session missing',
];

type ErrorLike = {
    message?: unknown;
    name?: unknown;
    status?: unknown;
    code?: unknown;
};

export function toAuthErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message || 'Unknown auth lookup error';
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as ErrorLike).message;
        if (typeof message === 'string' && message.trim().length > 0) return message;
    }
    return 'Unknown auth lookup error';
}

function getStatusCode(error: unknown): number | null {
    if (!error || typeof error !== 'object') return null;
    if (!('status' in error)) return null;
    const status = (error as ErrorLike).status;
    if (typeof status === 'number' && Number.isFinite(status)) return status;
    if (typeof status === 'string' && /^\d+$/.test(status)) return Number(status);
    return null;
}

function getErrorCode(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null;
    if (!('code' in error)) return null;
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
}

export function classifyAuthLookupError(error: unknown): AuthLookupFailureKind {
    const message = toAuthErrorMessage(error).toLowerCase();
    if (message.includes('timed out')) return 'timeout';

    // Check error code first (structured, reliable)
    const code = getErrorCode(error);
    if (code === 'invalid_jwt' || code === 'jwt_expired' || code === 'session_not_found' || code === 'refresh_token_not_found') {
        return 'invalid_token';
    }

    const status = getStatusCode(error);
    if (status === 401 || status === 403) return 'invalid_token';

    if (INVALID_TOKEN_MARKERS.some((marker) => message.includes(marker))) {
        return 'invalid_token';
    }

    return 'transient';
}
