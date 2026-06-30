import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function test() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    console.log('Testing Redis with URL:', url);
    if (!url || !token) {
        console.error('Error: Redis credentials missing in .env.local');
        return;
    }
    const redis = new Redis({ url, token });
    try {
        await redis.set('test_key', 'hello_world');
        const val = await redis.get('test_key');
        console.log('Success! Retrieve test_key:', val);
    } catch (e) {
        console.error('Redis connection failed:', e);
    }
}

test();
