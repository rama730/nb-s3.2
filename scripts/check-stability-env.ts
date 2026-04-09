import { z } from 'zod'

import {
    getBooleanArg,
    getStringArg,
    parseArgs,
    repoPath,
    writeJsonFile,
} from './lib/stability'

const TARGETS = ['local', 'staging', 'production'] as const
type Target = typeof TARGETS[number]

const positiveIntSchema = z.coerce.number().int().positive()

function isHttpsUrl(value: string) {
    try {
        return new URL(value).protocol === 'https:'
    } catch {
        return false
    }
}

function readJwtAlgorithm(token: string): string | null {
    const parts = token.split('.')
    if (parts.length < 2) return null
    try {
        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg?: unknown }
        return typeof header.alg === 'string' ? header.alg : null
    } catch {
        return null
    }
}

function main() {
    const args = parseArgs(process.argv.slice(2))
    const target = getStringArg(args, 'target', 'local') as Target
    const strict = getBooleanArg(args, 'strict', false)

    if (!TARGETS.includes(target)) {
        throw new Error(`target must be one of ${TARGETS.join(', ')}`)
    }

    const errors: string[] = []
    const warnings: string[] = []

    const requiredEverywhere = [
        'DATABASE_URL',
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'APP_URL',
        'NEXT_PUBLIC_APP_URL',
    ]

    for (const name of requiredEverywhere) {
        if (!(process.env[name]?.trim())) {
            errors.push(`${name} is required`)
        }
    }

    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || ''
    const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET?.trim() || ''
    const supabaseJwtAlg = readJwtAlgorithm(supabaseAnonKey)
    if (supabaseJwtAlg?.startsWith('HS') && !supabaseJwtSecret) {
        warnings.push(
            'SUPABASE_JWT_SECRET is unset while NEXT_PUBLIC_SUPABASE_ANON_KEY uses a symmetric JWT algorithm; auth will fall back to verified Supabase user lookups instead of local token verification',
        )
    }

    const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim() || ''
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || ''
    if (!redisUrl || !redisToken) {
        if (target === 'local') {
            warnings.push('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are unset; local checks will not exercise distributed controls')
        } else {
            errors.push('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required')
        }
    }

    const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || ''
    if (target !== 'local' && !turnstileSiteKey) {
        errors.push('NEXT_PUBLIC_TURNSTILE_SITE_KEY is required outside local development')
    }

    const otlpEndpoint =
        process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim()
        || process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
        || ''
    if (target !== 'local' && !otlpEndpoint) {
        errors.push('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT or OTEL_EXPORTER_OTLP_ENDPOINT is required')
    }

    const appUrl = process.env.APP_URL?.trim() || ''
    const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || ''
    if (target !== 'local') {
        if (!isHttpsUrl(appUrl)) errors.push('APP_URL must be https outside local development')
        if (!isHttpsUrl(publicAppUrl)) errors.push('NEXT_PUBLIC_APP_URL must be https outside local development')
    }

    const presenceTokenSecret = process.env.PRESENCE_TOKEN_SECRET?.trim() || ''
    if (target !== 'local' && !presenceTokenSecret) {
        errors.push('PRESENCE_TOKEN_SECRET is required outside local development')
    } else if (!presenceTokenSecret) {
        warnings.push('PRESENCE_TOKEN_SECRET is unset; realtime presence token issuance will fail until the secret is configured')
    }

    const presenceWsUrl =
        process.env.NEXT_PUBLIC_PRESENCE_WS_URL?.trim()
        || process.env.PRESENCE_WS_URL?.trim()
        || ''
    if (target !== 'local' && !presenceWsUrl) {
        errors.push('NEXT_PUBLIC_PRESENCE_WS_URL or PRESENCE_WS_URL is required outside local development')
    }

    const inngestExecutionRole = process.env.INNGEST_EXECUTION_ROLE?.trim() || ''
    if (inngestExecutionRole && inngestExecutionRole !== 'web' && inngestExecutionRole !== 'worker') {
        errors.push('INNGEST_EXECUTION_ROLE must be either web or worker')
    }
    if (!inngestExecutionRole) {
        if (target === 'local') {
            warnings.push('INNGEST_EXECUTION_ROLE is unset; local runtime will default to worker mode')
        } else {
            errors.push('INNGEST_EXECUTION_ROLE must be explicitly set outside local development')
        }
    }

    const rateLimitMode = process.env.RATE_LIMIT_MODE?.trim() || ''
    if (target !== 'local' && rateLimitMode !== 'distributed-only') {
        errors.push('RATE_LIMIT_MODE must be distributed-only for staging/production')
    }

    if (target !== 'local' && process.env.LOAD_SHEDDING_ENABLED?.trim() === 'false') {
        errors.push('LOAD_SHEDDING_ENABLED must not be false for staging/production')
    }
    if (!process.env.LOAD_SHEDDING_ENABLED?.trim()) {
        warnings.push('LOAD_SHEDDING_ENABLED is unset; runtime defaults will be used')
    }

    const workerBudgetVars = [
        'GITHUB_SYNC_MAX_FILES',
        'GITHUB_SYNC_MAX_BYTES',
        'GITHUB_SYNC_MAX_FILE_BYTES',
        'GITHUB_SYNC_APPLY_CONCURRENCY',
    ]
    for (const name of workerBudgetVars) {
        const raw = process.env[name]?.trim()
        if (!raw) {
            warnings.push(`${name} is unset; runtime defaults will be used`)
            continue
        }
        if (!positiveIntSchema.safeParse(raw).success) {
            errors.push(`${name} must be a positive integer`)
        }
    }

    const loadSheddingVars = [
        'LOAD_SHED_PUBLIC_BURST',
        'LOAD_SHED_PUBLIC_REFILL_PER_SECOND',
        'LOAD_SHED_USER_SHELL_BURST',
        'LOAD_SHED_USER_SHELL_REFILL_PER_SECOND',
        'LOAD_SHED_ACTIVE_SURFACE_BURST',
        'LOAD_SHED_ACTIVE_SURFACE_REFILL_PER_SECOND',
    ]
    for (const name of loadSheddingVars) {
        const raw = process.env[name]?.trim()
        if (!raw) {
            warnings.push(`${name} is unset; runtime defaults will be used`)
            continue
        }
        if (!positiveIntSchema.safeParse(raw).success) {
            errors.push(`${name} must be a positive integer`)
        }
    }

    if (!process.env.GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY?.trim()) {
        if (target === 'local') {
            warnings.push('GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY is unset; Git/import flows cannot be validated locally')
        } else {
            errors.push('GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY is required')
        }
    }

    if (!process.env.AUTH_DEGRADED_MODE_ENABLED?.trim()) {
        warnings.push('AUTH_DEGRADED_MODE_ENABLED is unset; runtime default will be used')
    }

    const report = {
        checkedAt: new Date().toISOString(),
        target,
        strict,
        ok: errors.length === 0,
        errors,
        warnings,
        resolved: {
            hasRedis: Boolean(redisUrl && redisToken),
            hasTurnstile: Boolean(turnstileSiteKey),
            hasOtlp: Boolean(otlpEndpoint),
            hasPresenceWsUrl: Boolean(presenceWsUrl),
            rateLimitMode: rateLimitMode || null,
            inngestExecutionRole: inngestExecutionRole || null,
        },
    }

    writeJsonFile(repoPath('reports', 'stability', 'env', `${target}.json`), report)

    if (errors.length > 0) {
        throw new Error(`env validation failed:\n- ${errors.join('\n- ')}`)
    }

    if (strict && warnings.length > 0) {
        throw new Error(`strict env validation warnings:\n- ${warnings.join('\n- ')}`)
    }

    console.log(`[stability-env] ok for ${target}`)
    if (warnings.length > 0) {
        console.log(`[stability-env] warnings:\n- ${warnings.join('\n- ')}`)
    }
}

try {
    main()
} catch (error) {
    console.error('[stability-env] failed:', error)
    process.exit(1)
}
