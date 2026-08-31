import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { getEnv } from '@/lib/env'
import { logger } from '@/lib/logger'

const env = getEnv()
const connectionString = env.DATABASE_URL
const isDevelopment = env.NODE_ENV === 'development'

function readIntEnv(name: string, fallback: number, min: number, max: number) {
    const raw = process.env[name]
    const parsed = raw ? Number(raw) : fallback
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function resolvePoolerConnectionString(raw: string, targetPort: string = '6543') {
    if (isDevelopment || process.env.DB_USE_SUPAVISOR_PORT === 'false') return raw

    try {
        const url = new URL(raw)
        if (url.port === '5432') {
            url.port = targetPort
        }
        return url.toString()
    } catch {
        return raw.replace(':5432/', `:${targetPort}/`)
    }
}

function isTransactionPoolerUrl(raw: string) {
    try {
        const url = new URL(raw)
        return url.port === '6543' || /pooler|supavisor/i.test(url.hostname)
    } catch {
        return raw.includes(':6543/') || /pooler|supavisor/i.test(raw)
    }
}

function resolvePreparedStatementsEnabled(raw: string) {
    const explicit = process.env.DB_PREPARE_STATEMENTS?.trim().toLowerCase()
    if (explicit === 'true') return true
    if (explicit === 'false') return false
    return isDevelopment && !isTransactionPoolerUrl(raw)
}

const dbPoolMax = readIntEnv('DB_POOL_MAX', isDevelopment ? 5 : 20, 1, 100)
const dbIdleTimeoutSeconds = readIntEnv('DB_IDLE_TIMEOUT_SECONDS', isDevelopment ? 10 : 60, 5, 600)
const dbConnectTimeoutSeconds = readIntEnv('DB_CONNECT_TIMEOUT_SECONDS', 10, 2, 60)

/**
 * Singleton connection pattern for Next.js HMR
 */
const globalForDb = globalThis as unknown as {
    conn: postgres.Sql | undefined
    readConn: postgres.Sql | undefined
}

// Write Client (Primary)
// In production, we force the use of the Supavisor connection pooler port (6543) 
// to prevent connection exhaustion under 1M+ user load.
const resolvedConnectionString = resolvePoolerConnectionString(connectionString)
const dbPreparedStatementsEnabled = resolvePreparedStatementsEnabled(resolvedConnectionString)

const client = globalForDb.conn ?? postgres(resolvedConnectionString, {
    prepare: dbPreparedStatementsEnabled,
    max: dbPoolMax,
    idle_timeout: dbIdleTimeoutSeconds,
    connect_timeout: dbConnectTimeoutSeconds,
    onnotice: (notice) => logger.debug('pg notice', { module: 'db', message: notice.message }),
    onclose: () => logger.debug('pg connection closed', { module: 'db' }),
})

// Read Client (explicit replica, otherwise the primary pool)
const resolvedReadConnectionString = env.READ_DATABASE_URL
    ? resolvePoolerConnectionString(env.READ_DATABASE_URL)
    : resolvedConnectionString
const readDbPreparedStatementsEnabled = resolvePreparedStatementsEnabled(resolvedReadConnectionString)

const readClient = globalForDb.readConn ?? (
    resolvedReadConnectionString === resolvedConnectionString 
        ? client 
        : postgres(resolvedReadConnectionString, {
            prepare: readDbPreparedStatementsEnabled,
            max: dbPoolMax,
            idle_timeout: dbIdleTimeoutSeconds,
            connect_timeout: dbConnectTimeoutSeconds,
        })
)

if (process.env.NODE_ENV !== 'production') {
    globalForDb.conn = client
    globalForDb.readConn = readClient
}

export const db = drizzle(client, { schema })
export const readDb = drizzle(readClient, { schema })

export async function pingDb(): Promise<boolean> {
    try {
        await client`SELECT 1`
        return true
    } catch {
        return false
    }
}
