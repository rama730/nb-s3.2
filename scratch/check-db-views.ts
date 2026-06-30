import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

async function checkViews() {
    console.log('--- Checking DB project view counts ---');
    const rows = await db
        .select({ id: projects.id, title: projects.title, slug: projects.slug, viewCount: projects.viewCount })
        .from(projects);

    console.table(rows);
}

checkViews().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
