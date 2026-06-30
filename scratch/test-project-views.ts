import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redis } from '@/lib/redis';
import { incrementProjectViewAction, getProjectLiveStatsAction } from '@/app/actions/project/_all';

async function runTest() {
    console.log('--- 1. Querying a test project from DB ---');
    const [project] = await db
        .select({ id: projects.id, title: projects.title, viewCount: projects.viewCount })
        .from(projects)
        .limit(1);

    if (!project) {
        console.error('No projects found in database');
        return;
    }

    const projectId = project.id;
    console.log(`Using project: "${project.title}" (ID: ${projectId})`);
    console.log('Current DB view count:', project.viewCount);

    console.log('\n--- 2. Cleaning up Redis keys for this project to start fresh ---');
    if (redis) {
        await redis.hdel('project:views', projectId);
        // Delete any rate limit keys for this project
        const keys = await redis.keys(`ratelimit:*:${projectId}:*`);
        for (const key of keys) {
            await redis.del(key);
        }
        console.log('Redis keys cleared.');
    } else {
        console.log('Redis is not available.');
    }

    console.log('\n--- 3. Simulating first view (incrementProjectViewAction) ---');
    try {
        // Mocking createClient auth getUser to bypass auth checks in the server action if any,
        // or let's see what happens when we run it.
        const res = await incrementProjectViewAction(projectId);
        console.log('incrementProjectViewAction result:', res);
    } catch (err) {
        console.error('incrementProjectViewAction threw error:', err);
    }

    console.log('\n--- 4. Checking Redis buffered views ---');
    if (redis) {
        const bufferedVal = await redis.hget('project:views', projectId);
        console.log(`Redis project:views hash for ${projectId}:`, bufferedVal);
    }

    console.log('\n--- 5. Simulating live stats fetch (getProjectLiveStatsAction) ---');
    try {
        const stats = await getProjectLiveStatsAction(projectId);
        console.log('getProjectLiveStatsAction result:', stats);
    } catch (err) {
        console.error('getProjectLiveStatsAction threw error:', err);
    }

    console.log('\n--- 6. Simulating second view (should be rate-limited but return live stats) ---');
    try {
        const res2 = await incrementProjectViewAction(projectId);
        console.log('Second incrementProjectViewAction result (should be rate-limited):', res2);
    } catch (err) {
        console.error('Second incrementProjectViewAction threw error:', err);
    }
}

runTest().then(() => process.exit(0)).catch(err => {
    console.error('Unhandled script error:', err);
    process.exit(1);
});
