import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { incrementProjectViewAction } from '@/app/actions/project/_all';

async function testSpecificProject() {
    const projectId = '561f8a9b-b811-4af9-93e6-1c024e0a37f8';
    
    console.log('--- 1. Querying current DB views for Antigravity Awesome Skills ---');
    const [project] = await db
        .select({ id: projects.id, title: projects.title, viewCount: projects.viewCount })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
        
    if (!project) {
        console.error('Project not found!');
        return;
    }
    console.log(`Current DB view count: ${project.viewCount}`);

    console.log('\n--- 2. Simulating incrementProjectViewAction ---');
    const res = await incrementProjectViewAction(projectId);
    console.log('Result:', res);

    console.log('\n--- 3. Querying DB views again ---');
    const [projectAfter] = await db
        .select({ id: projects.id, title: projects.title, viewCount: projects.viewCount })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
    console.log(`New DB view count: ${projectAfter?.viewCount}`);
}

testSpecificProject().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
