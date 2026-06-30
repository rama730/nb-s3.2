import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { redis } from '@/lib/redis';

async function checkRedis() {
    console.log('--- Checking Redis buffered views ---');
    if (!redis) {
        console.log('Redis client is null or undefined (not configured).');
        return;
    }

    try {
        const allViews = await redis.hgetall('project:views');
        console.log('Redis project:views hash content:', allViews);
    } catch (e) {
        console.error('Error fetching from Redis:', e);
    }
}

checkRedis().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
