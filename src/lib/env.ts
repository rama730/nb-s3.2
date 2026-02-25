import { z } from 'zod'

const envSchema = z.object({
    DATABASE_URL: z.string().min(1),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

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

export function getEnv(): Env {
    if (_validated) return _validated

    const result = envSchema.safeParse(process.env)
    if (!result.success) {
        const missing = result.error.issues
            .map((i) => `  ${i.path.join('.')}: ${i.message}`)
            .join('\n')
        throw new Error(`Environment validation failed:\n${missing}`)
    }

    _validated = result.data
    return _validated
}
