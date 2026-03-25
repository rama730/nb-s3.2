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

const dbPoolMax = readIntEnv('DB_POOL_MAX', isDevelopment ? 5 : 50, 1, 100)
const dbIdleTimeoutSeconds = readIntEnv('DB_IDLE_TIMEOUT_SECONDS', isDevelopment ? 10 : 60, 5, 600)
const dbConnectTimeoutSeconds = readIntEnv('DB_CONNECT_TIMEOUT_SECONDS', 10, 2, 60)
const dbPreparedStatementsEnabled = process.env.DB_PREPARE_STATEMENTS !== 'false'

/**
 * Singleton connection pattern for Next.js HMR
 */
const globalForDb = globalThis as unknown as {
    conn: postgres.Sql | undefined
    readConn: postgres.Sql | undefined
}

// Write Client (Primary)
const client = globalForDb.conn ?? postgres(connectionString, {
    prepare: dbPreparedStatementsEnabled,
    max: dbPoolMax,
    idle_timeout: dbIdleTimeoutSeconds,
    connect_timeout: dbConnectTimeoutSeconds,
    onnotice: (notice) => logger.debug('pg notice', { module: 'db', message: notice.message }),
    onclose: () => logger.warn('pg connection closed', { module: 'db' }),
})

// Read Client (Replica Fallback)
const readConnectionString = env.READ_DATABASE_URL || connectionString
const readClient = globalForDb.readConn ?? (
    readConnectionString === connectionString 
        ? client 
        : postgres(readConnectionString, {
            prepare: dbPreparedStatementsEnabled,
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
