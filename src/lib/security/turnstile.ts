import { logger } from '@/lib/logger';

export type TurnstileVerificationResult = {
    success: boolean;
    error?: string;
    errorCodes?: string[];
    bypassed?: boolean;
    degraded?: boolean;
};

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 1500;

export function getTurnstileSecretKey(): string {
    return (
        process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY?.trim() ||
        process.env.TURNSTILE_SECRET_KEY?.trim() ||
        ''
    );
}

export function isTurnstileServerConfigured(): boolean {
    return getTurnstileSecretKey().length > 0;
}

export async function verifyTurnstileToken(params: {
    token: string;
    ip?: string | null;
    expectedAction?: string;
}): Promise<TurnstileVerificationResult> {
    const secretKey = getTurnstileSecretKey();

    // In local development or test environments without a configured secret key,
    // gracefully permit validation to avoid breaking workflows.
    if (!secretKey) {
        return { success: true, bypassed: true };
    }

    if (!params.token || typeof params.token !== 'string' || !params.token.trim()) {
        return { success: false, error: 'Turnstile token is required.' };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const formData = new URLSearchParams();
        formData.append('secret', secretKey);
        formData.append('response', params.token.trim());
        if (params.ip && params.ip !== 'unknown') {
            formData.append('remoteip', params.ip.trim());
        }

        const response = await fetch(SITEVERIFY_URL, {
            method: 'POST',
            body: formData,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            logger.warn('[turnstile] Verification endpoint returned non-200 status', {
                status: response.status,
            });
            // Fail open on Cloudflare server errors to prevent dropping legitimate users
            return { success: true, degraded: true };
        }

        const data = (await response.json()) as {
            success: boolean;
            'error-codes'?: string[];
            action?: string;
            cdata?: string;
        };

        if (!data.success) {
            return {
                success: false,
                error: 'Turnstile verification failed. Please try again.',
                errorCodes: data['error-codes'],
            };
        }

        if (params.expectedAction && data.action && data.action !== params.expectedAction) {
            logger.warn('[turnstile] Action mismatch', {
                expected: params.expectedAction,
                received: data.action,
            });
            return {
                success: false,
                error: 'Turnstile verification action mismatch.',
            };
        }

        return { success: true };
    } catch (err) {
        clearTimeout(timeoutId);
        const isTimeout = err instanceof Error && err.name === 'AbortError';

        logger.warn('[turnstile] Verification request failed or timed out', {
            isTimeout,
            error: err instanceof Error ? err.message : String(err),
        });

        // Fail-open degraded mode on network timeout so edge latency does not block signups
        return { success: true, degraded: true };
    }
}
