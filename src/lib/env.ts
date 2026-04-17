import { z } from 'zod'

const envSchema = z.object({
    DATABASE_URL: z.string().min(1),
    READ_DATABASE_URL: z.string().url().optional(),
    APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    CSRF_TOKEN_SECRET: z.string().min(1).optional(),
    SECURITY_STEPUP_SECRET: z.string().min(1).optional(),
    SECURITY_RECOVERY_CODE_SECRET: z.string().min(1).optional(),
    AUDIT_METADATA_HASH_SECRET: z.string().min(1).optional(),
    GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
    JOB_REQUEST_SECRET: z.string().min(1).optional(),
    GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
    PRESENCE_TOKEN_SECRET: z.string().min(1).optional(),
    PRESENCE_EVENT_SECRET: z.string().min(1).optional(),
    PRESENCE_WS_URL: z.string().url().optional(),
    NEXT_PUBLIC_PRESENCE_WS_URL: z.string().url().optional(),
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    E2E_AUTH_FALLBACK: z.string().optional(),
    NEXT_PUBLIC_E2E_AUTH_FALLBACK: z.string().optional(),

    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
    INNGEST_EVENT_KEY: z.string().optional(),
    ADMIN_USER_IDS: z.string().optional(),

    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).optional(),
    DB_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(600).optional(),
    DB_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(2).max(60).optional(),
    DB_PREPARE_STATEMENTS: z.string().optional(),
    RATE_LIMIT_MODE: z.enum(['best-effort', 'distributed-only']).optional(),
    EXECUTION_BACKEND_URL: z.string().url().optional(),
})

export type Env = z.infer<typeof envSchema>

let _validated: Env | null = null

function isTruthyEnvFlag(value: string | undefined) {
    const normalized = value?.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function assertProductionSecurityEnv(env: Env) {
    if (env.NODE_ENV !== 'production') return

    const requiredSecrets = [
        ['CSRF_TOKEN_SECRET', env.CSRF_TOKEN_SECRET],
        ['SECURITY_STEPUP_SECRET', env.SECURITY_STEPUP_SECRET],
        ['SECURITY_RECOVERY_CODE_SECRET', env.SECURITY_RECOVERY_CODE_SECRET],
        ['AUDIT_METADATA_HASH_SECRET', env.AUDIT_METADATA_HASH_SECRET],
        ['GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY', env.GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY],
        ['JOB_REQUEST_SECRET', env.JOB_REQUEST_SECRET],
        ['GITHUB_WEBHOOK_SECRET', env.GITHUB_WEBHOOK_SECRET],
        ['PRESENCE_TOKEN_SECRET', env.PRESENCE_TOKEN_SECRET],
        ['PRESENCE_EVENT_SECRET', env.PRESENCE_EVENT_SECRET],
        ['INNGEST_EVENT_KEY', env.INNGEST_EVENT_KEY],
        ['INNGEST_SIGNING_KEY', env.INNGEST_SIGNING_KEY],
    ] as const

    const missing = requiredSecrets
        .filter(([, value]) => !value?.trim())
        .map(([name]) => name)

    if (missing.length > 0) {
        throw new Error(`Production security environment is missing required values: ${missing.join(', ')}`)
    }

    const presenceWsUrl = env.NEXT_PUBLIC_PRESENCE_WS_URL?.trim() || env.PRESENCE_WS_URL?.trim() || ''
    if (!presenceWsUrl) {
        throw new Error('Production security environment requires NEXT_PUBLIC_PRESENCE_WS_URL or PRESENCE_WS_URL')
    }
    if (!presenceWsUrl.startsWith('wss://')) {
        throw new Error('Production presence websocket URL must use wss://')
    }

    if (isTruthyEnvFlag(env.E2E_AUTH_FALLBACK) || isTruthyEnvFlag(env.NEXT_PUBLIC_E2E_AUTH_FALLBACK)) {
        throw new Error('Production environment must not enable E2E auth fallback flags')
    }
}

export function validateEnv(rawEnv: NodeJS.ProcessEnv): Env {
    const result = envSchema.safeParse(rawEnv)
    if (!result.success) {
        const missing = result.error.issues
            .map((i) => `  ${i.path.join('.')}: ${i.message}`)
            .join('\n')
        throw new Error(`Environment validation failed:\n${missing}`)
    }

    assertProductionSecurityEnv(result.data)
    return result.data
}

export function getEnv(): Env {
    if (_validated) return _validated

    _validated = validateEnv(process.env)
    return _validated
}
