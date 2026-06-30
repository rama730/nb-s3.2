import { db } from './src/lib/db';
import { connections } from './src/lib/db/schema';
import { eq, or, and } from 'drizzle-orm';
import { getRedisClient } from './src/lib/redis';

async function test() {
    console.log("Checking DB connections...");
    const conns = await db.select().from(connections).limit(5);
    console.log("Found:", conns);
}

test().catch(console.error).finally(() => process.exit(0));
