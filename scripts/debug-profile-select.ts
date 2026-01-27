import { config } from 'dotenv'
config({ path: '.env.local' })

import { db } from '../src/lib/db'
import { profiles } from '../src/lib/db/schema'
import { eq } from 'drizzle-orm'

async function run() {
    console.log('Testing Profile Query...')
    // Use the ID from the error message
    const testId = '2b4030a1-b030-4a50-811a-0da96b88c224'

    try {
        console.log('Running select query...')
        const result = await db.select().from(profiles).where(eq(profiles.id, testId)).limit(1)
        console.log('Success:', result)
    } catch (e) {
        console.error('Failure:', e)
        // inspect error properties if possible
    }
    process.exit(0)
}

run()
