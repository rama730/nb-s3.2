import type { Session, SupabaseClient, User } from '@supabase/supabase-js'
import { isEmailVerified } from '@/lib/auth/email-verification'
import { resolveSupabasePublicEnv } from '@/lib/supabase/env'

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000
const JWT_SECRET_ENV = process.env.SUPABASE_JWT_SECRET?.trim() || null
const AUTH_SNAPSHOT_NETWORK_TIMEOUT_MS = readTimeoutMsFromEnv(
    'AUTH_MIDDLEWARE_LOOKUP_TIMEOUT_MS',
    4_000,
)

type JwtHeader = {
    alg?: string
    kid?: string
    typ?: string
}

type JwtPayload = Record<string, unknown> & {
    sub?: string
    exp?: number
    iat?: number
    nbf?: number
    role?: string
    session_id?: string
    email?: string
    email_confirmed_at?: string
    confirmed_at?: string
    email_verified?: boolean | string
    app_metadata?: Record<string, unknown>
    user_metadata?: Record<string, unknown>
}

type JwksResponse = {
    keys: JsonWebKey[]
}

type CachedJwksEntry = {
    fetchedAt: number
    value: JwksResponse
}

const jwksCache = new Map<string, CachedJwksEntry>()

function readTimeoutMsFromEnv(name: string, fallback: number) {
    const raw = process.env[name]
    if (!raw) return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 250) return fallback
    return Math.trunc(parsed)
}

export type AuthSnapshot = {
    userId: string
    sessionId: string | null
    onboardingComplete: boolean
    emailVerified: boolean
    issuedAt: number | null
    expiresAt: number | null
    roles: string[]
    email: string | null
    appMetadata: Record<string, unknown>
    userMetadata: Record<string, unknown>
}

export type AuthSnapshotResolution = {
    session: Session | null
    snapshot: AuthSnapshot | null
    user: User | null
    error: { name: 'AuthError'; message: string; status: number } | null
}

type AuthSnapshotAwareClient = SupabaseClient & {
    __getUserFromAuthServer?: (jwt?: string) => Promise<{
        data: { user: User | null }
        error: { message?: string; status?: number } | null
    }>
}

type DecodedJwt = {
    header: JwtHeader
    payload: JwtPayload
    signature: Uint8Array
    signingInput: Uint8Array
}

function normalizeBase64Url(value: string) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4
    return padding === 0 ? normalized : normalized + '='.repeat(4 - padding)
}

function decodeBase64UrlToString(value: string) {
    const normalized = normalizeBase64Url(value)
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(normalized, 'base64').toString('utf8')
    }

    const decoded = globalThis.atob(normalized)
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
}

function decodeBase64UrlToBytes(value: string) {
    const normalized = normalizeBase64Url(value)
    if (typeof Buffer !== 'undefined') {
        return Uint8Array.from(Buffer.from(normalized, 'base64'))
    }

    const decoded = globalThis.atob(normalized)
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0))
}

function encodeUtf8(value: string) {
    return new TextEncoder().encode(value)
}

function toArrayBuffer(bytes: Uint8Array) {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy.buffer
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
}

function parseNumericClaim(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

function decodeJwt(token: string): DecodedJwt {
    const parts = token.split('.')
    if (parts.length !== 3) {
        throw new Error('Invalid JWT format')
    }

    const [rawHeader, rawPayload, rawSignature] = parts
    const header = JSON.parse(decodeBase64UrlToString(rawHeader)) as JwtHeader
    const payload = JSON.parse(decodeBase64UrlToString(rawPayload)) as JwtPayload

    return {
        header,
        payload,
        signature: decodeBase64UrlToBytes(rawSignature),
        signingInput: encodeUtf8(`${rawHeader}.${rawPayload}`),
    }
}

function tryDecodeJwtPayload(token: string): JwtPayload | null {
    try {
        return decodeJwt(token).payload
    } catch {
        return null
    }
}

function assertTemporalClaims(payload: JwtPayload, nowSeconds = Date.now() / 1000) {
    const exp = parseNumericClaim(payload.exp)
    if (exp !== null && exp <= nowSeconds) {
        throw new Error('JWT has expired')
    }

    const nbf = parseNumericClaim(payload.nbf)
    if (nbf !== null && nbf > nowSeconds) {
        throw new Error('JWT is not active yet')
    }
}

function getJwtVerifyAlgorithm(alg: string): RsaHashedImportParams | HmacImportParams {
    switch (alg) {
        case 'RS256':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
        case 'RS384':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' }
        case 'RS512':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }
        case 'HS256':
            return { name: 'HMAC', hash: 'SHA-256' }
        case 'HS384':
            return { name: 'HMAC', hash: 'SHA-384' }
        case 'HS512':
            return { name: 'HMAC', hash: 'SHA-512' }
        default:
            throw new Error(`Unsupported JWT algorithm: ${alg}`)
    }
}

function getJwkImportAlgorithm(alg: string): RsaHashedImportParams {
    switch (alg) {
        case 'RS256':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
        case 'RS384':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' }
        case 'RS512':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }
        default:
            throw new Error(`Unsupported JWK algorithm: ${alg}`)
    }
}

async function fetchSupabaseJwks(): Promise<JwksResponse> {
    const env = resolveSupabasePublicEnv('auth.snapshot')
    const cacheKey = env.url.replace(/\/$/, '')
    const cached = jwksCache.get(cacheKey)
    const now = Date.now()

    if (cached && now - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
        return cached.value
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), AUTH_SNAPSHOT_NETWORK_TIMEOUT_MS)
    let response: Response
    try {
        response = await fetch(`${cacheKey}/auth/v1/.well-known/jwks.json`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
            cache: 'force-cache',
            signal: controller.signal,
        })
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('Auth snapshot JWKS lookup timed out')
        }
        throw error
    } finally {
        clearTimeout(timeoutId)
    }

    if (!response.ok) {
        throw new Error(`Unable to fetch Supabase JWKS (${response.status})`)
    }

    const value = await response.json() as JwksResponse
    if (!Array.isArray(value.keys) || value.keys.length === 0) {
        throw new Error('Supabase JWKS response is empty')
    }

    jwksCache.set(cacheKey, {
        fetchedAt: now,
        value,
    })

    return value
}

async function verifyAsymmetricJwt(token: DecodedJwt) {
    const alg = token.header.alg
    const kid = token.header.kid

    if (!alg || !kid) {
        throw new Error('JWT is missing signing metadata')
    }

    const jwks = await fetchSupabaseJwks()
    const jwk = jwks.keys.find((candidate) => (candidate as JsonWebKey & { kid?: string }).kid === kid)
    if (!jwk) {
        throw new Error(`Unable to find JWKS key for kid ${kid}`)
    }

    const publicKey = await crypto.subtle.importKey(
        'jwk',
        jwk,
        getJwkImportAlgorithm(alg),
        true,
        ['verify'],
    )

    const verified = await crypto.subtle.verify(
        getJwtVerifyAlgorithm(alg),
        publicKey,
        toArrayBuffer(token.signature),
        toArrayBuffer(token.signingInput),
    )

    if (!verified) {
        throw new Error('Invalid JWT signature')
    }
}

async function verifySymmetricJwt(token: DecodedJwt) {
    const alg = token.header.alg
    if (!alg) {
        throw new Error('JWT is missing algorithm metadata')
    }

    if (!JWT_SECRET_ENV) {
        throw new Error('SUPABASE_JWT_SECRET is required for symmetric Supabase JWT verification')
    }

    const secretKey = await crypto.subtle.importKey(
        'raw',
        encodeUtf8(JWT_SECRET_ENV),
        getJwtVerifyAlgorithm(alg),
        false,
        ['verify'],
    )

    const verified = await crypto.subtle.verify(
        getJwtVerifyAlgorithm(alg),
        secretKey,
        toArrayBuffer(token.signature),
        toArrayBuffer(token.signingInput),
    )

    if (!verified) {
        throw new Error('Invalid JWT signature')
    }
}

export async function verifySupabaseAccessToken(accessToken: string): Promise<JwtPayload> {
    const token = decodeJwt(accessToken)
    const alg = token.header.alg

    assertTemporalClaims(token.payload)

    if (!alg) {
        throw new Error('JWT is missing algorithm metadata')
    }

    if (alg.startsWith('HS')) {
        await verifySymmetricJwt(token)
    } else {
        await verifyAsymmetricJwt(token)
    }

    return token.payload
}

function readRoles(payload: JwtPayload, appMetadata: Record<string, unknown>): string[] {
    const roles = new Set<string>()
    const payloadRole = typeof payload.role === 'string' ? payload.role.trim() : ''
    if (payloadRole) roles.add(payloadRole)

    const appRole = typeof appMetadata.role === 'string' ? appMetadata.role.trim() : ''
    if (appRole) roles.add(appRole)

    const appRoles = appMetadata.roles
    if (Array.isArray(appRoles)) {
        for (const candidate of appRoles) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                roles.add(candidate.trim())
            }
        }
    }

    return [...roles]
}

export function buildAuthSnapshotFromClaims(payload: JwtPayload): AuthSnapshot | null {
    const userId = typeof payload.sub === 'string' && payload.sub.trim().length > 0
        ? payload.sub
        : null

    if (!userId) return null

    const userMetadata = asRecord(payload.user_metadata)
    const appMetadata = asRecord(payload.app_metadata)
    const username = typeof userMetadata.username === 'string' ? userMetadata.username.trim() : ''
    const onboarded = userMetadata.onboarded === true

    return {
        userId,
        sessionId: typeof payload.session_id === 'string' ? payload.session_id : null,
        onboardingComplete: onboarded || username.length > 0,
        emailVerified: isEmailVerified({
            email_confirmed_at: payload.email_confirmed_at,
            confirmed_at: payload.confirmed_at,
            email_verified: payload.email_verified,
            user_metadata: userMetadata,
            app_metadata: appMetadata,
        }),
        issuedAt: parseNumericClaim(payload.iat),
        expiresAt: parseNumericClaim(payload.exp),
        roles: readRoles(payload, appMetadata),
        email: typeof payload.email === 'string' ? payload.email : null,
        appMetadata,
        userMetadata,
    }
}

export function buildUserFromSnapshot(snapshot: AuthSnapshot): User {
    const createdAtIso = new Date((snapshot.issuedAt ?? Math.floor(Date.now() / 1000)) * 1000).toISOString()
    const isAnonymous =
        snapshot.appMetadata.provider === 'anonymous'
        || snapshot.appMetadata.anonymous === true
        || snapshot.appMetadata.is_anonymous === true
        || snapshot.roles.includes('anonymous')

    return {
        id: snapshot.userId,
        app_metadata: snapshot.appMetadata,
        user_metadata: snapshot.userMetadata,
        aud: 'authenticated',
        created_at: createdAtIso,
        updated_at: createdAtIso,
        email: snapshot.email ?? undefined,
        email_confirmed_at: snapshot.emailVerified ? createdAtIso : undefined,
        phone: undefined,
        role: snapshot.roles[0],
        factors: undefined,
        identities: [],
        is_anonymous: isAnonymous,
    } as unknown as User
}

function authError(message: string, status: number): AuthSnapshotResolution['error'] {
    return {
        name: 'AuthError',
        message,
        status,
    }
}

function buildAuthSnapshotFromVerifiedUser(user: User, session: Session): AuthSnapshot {
    const payload = tryDecodeJwtPayload(session.access_token)
    const appMetadata = asRecord(user.app_metadata)
    const userMetadata = asRecord(user.user_metadata)
    const username = typeof userMetadata.username === 'string' ? userMetadata.username.trim() : ''
    const onboarded = userMetadata.onboarded === true
    const expiresAtFromSession =
        typeof session.expires_at === 'number' && Number.isFinite(session.expires_at)
            ? session.expires_at
            : null

    return {
        userId: user.id,
        sessionId: typeof payload?.session_id === 'string' ? payload.session_id : null,
        onboardingComplete: onboarded || username.length > 0,
        emailVerified: isEmailVerified(user as unknown as Record<string, unknown>),
        issuedAt: parseNumericClaim(payload?.iat),
        expiresAt: parseNumericClaim(payload?.exp) ?? expiresAtFromSession,
        roles: readRoles(payload ?? {}, appMetadata),
        email: typeof user.email === 'string' ? user.email : null,
        appMetadata,
        userMetadata,
    }
}

async function fetchVerifiedUserFromAuthServer(
    supabase: SupabaseClient,
    accessToken: string,
) {
    const awareClient = supabase as AuthSnapshotAwareClient
    if (awareClient.__getUserFromAuthServer) {
        return awareClient.__getUserFromAuthServer(accessToken)
    }
    return supabase.auth.getUser(accessToken)
}

async function withAuthSnapshotTimeout<T>(
    promise: Promise<T>,
    label: string,
): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(`${label} timed out`))
                }, AUTH_SNAPSHOT_NETWORK_TIMEOUT_MS)
            }),
        ])
    } finally {
        if (timeoutId) clearTimeout(timeoutId)
    }
}

async function resolveAuthSnapshotFromRemoteUser(
    supabase: SupabaseClient,
    session: Session,
): Promise<AuthSnapshotResolution> {
    const userResponse = await withAuthSnapshotTimeout(
        fetchVerifiedUserFromAuthServer(supabase, session.access_token),
        'Auth snapshot remote lookup',
    )
    const user = userResponse.data.user ?? null

    if (!user || userResponse.error) {
        return {
            session: null,
            snapshot: null,
            user: null,
            error: authError(
                userResponse.error?.message || 'Unable to verify auth session',
                typeof userResponse.error?.status === 'number' ? userResponse.error.status : 401,
            ),
        }
    }

    const snapshot = buildAuthSnapshotFromVerifiedUser(user, session)
    return {
        session,
        snapshot,
        user,
        error: null,
    }
}

export async function resolveAuthSnapshot(
    supabase: SupabaseClient
): Promise<AuthSnapshotResolution> {
    const sessionResponse = await supabase.auth.getSession()
    const session = sessionResponse.data.session ?? null

    if (sessionResponse.error) {
        return {
            session,
            snapshot: null,
            user: null,
            error: authError(
                sessionResponse.error.message,
                sessionResponse.error.status ?? 500,
            ),
        }
    }

    if (!session?.access_token) {
        return {
            session,
            snapshot: null,
            user: null,
            error: null,
        }
    }

    try {
        const claims = await verifySupabaseAccessToken(session.access_token)
        const snapshot = buildAuthSnapshotFromClaims(claims)

        if (!snapshot) {
            return {
                session: null,
                snapshot: null,
                user: null,
                error: authError('JWT is missing subject claims', 401),
            }
        }

        return {
            session,
            snapshot,
            user: buildUserFromSnapshot(snapshot),
            error: null,
        }
    } catch (error) {
        try {
            return await resolveAuthSnapshotFromRemoteUser(supabase, session)
        } catch (remoteError) {
            const message = remoteError instanceof Error
                ? remoteError.message
                : error instanceof Error
                    ? error.message
                    : 'Unable to verify auth session'
            return {
                session: null,
                snapshot: null,
                user: null,
                error: authError(message, 401),
            }
        }
    }
}
