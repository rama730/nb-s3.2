import { config } from 'dotenv'
config({ path: '.env.local' })

import { db } from '../src/lib/db'
import { connections } from '../src/lib/db/schema'
import { or, and, eq, count } from 'drizzle-orm'

async function run() {
    console.log('Testing DB connection...')
    // Use the ID from the error message
    const testId = '08650344-274a-4cc5-bd43-b55be0480df1'

    try {
        console.log('Running count query...')
        const res = await db.select({ count: count() }).from(connections).where(
            or(
                and(eq(connections.requesterId, testId), eq(connections.status, 'accepted')),
                and(eq(connections.addresseeId, testId), eq(connections.status, 'accepted'))
            )
        )
        console.log('Success:', res)
    } catch (e) {
        console.error('Failure:', e)
    }
    process.exit(0)
}

run()
