import { NextResponse } from 'next/server'

/**
 * Validates that the request origin matches the host.
 * Returns null if valid, or an error response if CSRF check fails.
 */
export function validateCsrf(request: Request): NextResponse | null {
    const origin = request.headers.get('origin')
    const host = request.headers.get('host')

    if (!origin || !host) return null

    try {
        const originHost = new URL(origin).host
        if (originHost !== host) {
            return NextResponse.json(
                { error: 'Origin mismatch' },
                { status: 403 }
            )
        }
    } catch {
        return NextResponse.json(
            { error: 'Invalid origin' },
            { status: 403 }
        )
    }

    return null
}
