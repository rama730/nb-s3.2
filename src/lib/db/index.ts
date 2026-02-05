import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!

/**
 * Singleton connection pattern for Next.js HMR
 * Prevents multiple connection pools during development
 */
const globalForDb = globalThis as unknown as {
    conn: postgres.Sql | undefined
}

const client = globalForDb.conn ?? postgres(connectionString, {
    prepare: false,
    // Add max connections limit for dev to prevent exhaustion
    max: process.env.NODE_ENV === 'development' ? 5 : 10,
    idle_timeout: 10 // Close idle connections after 10 seconds
})

if (process.env.NODE_ENV !== 'production') {
    globalForDb.conn = client
}

export const db = drizzle(client, { schema })
