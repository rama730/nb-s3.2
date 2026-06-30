import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { db } from '@/lib/db';
import { projects, projectFollows } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { incrementProjectViewAction, getProjectLiveStatsAction, toggleProjectFollowAction } from '@/app/actions/project/_all';

async function runTest() {
    console.log('--- 1. Fetching a test project ---');
    const [project] = await db
        .select({ id: projects.id, title: projects.title, viewCount: projects.viewCount, followersCount: projects.followersCount })
        .from(projects)
        .limit(1);

    if (!project) {
        console.error('No project found in database.');
        return;
    }
    const projectId = project.id;
    console.log(`Using Project: "${project.title}" (ID: ${projectId})`);
    console.log(`Initial DB State -> views: ${project.viewCount}, followers: ${project.followersCount}`);

    console.log('\n--- 2. Simulating page view increment (incrementProjectViewAction) ---');
    const viewRes = await incrementProjectViewAction(projectId);
    console.log('Increment view result:', viewRes);

    console.log('\n--- 3. Fetching live stats (getProjectLiveStatsAction) ---');
    const statsRes = await getProjectLiveStatsAction(projectId);
    console.log('Live stats result:', statsRes);

    console.log('\n--- 4. Toggling follow (toggleProjectFollowAction) ---');
    // Note: toggleProjectFollowAction requires a logged-in user session in normal use.
    // In raw server scripts, it will use the default service role or whatever is active in auth client.
    try {
        console.log('Attempting to follow...');
        const followRes = await toggleProjectFollowAction(projectId, true);
        console.log('Follow action result:', followRes);

        console.log('Attempting to unfollow...');
        const unfollowRes = await toggleProjectFollowAction(projectId, false);
        console.log('Unfollow action result:', unfollowRes);
    } catch (e: any) {
        console.error('Follow action failed (expected if not authenticated):', e.message);
    }

    console.log('\n--- 5. Querying DB state after simulation ---');
    const [finalProject] = await db
        .select({ viewCount: projects.viewCount, followersCount: projects.followersCount })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
    console.log(`Final DB State -> views: ${finalProject?.viewCount}, followers: ${finalProject?.followersCount}`);
}

runTest().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
