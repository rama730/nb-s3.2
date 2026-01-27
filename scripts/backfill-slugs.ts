import 'dotenv/config';
import { db } from '../src/lib/db';
import { projects } from '../src/lib/db/schema';
import { eq, isNull } from 'drizzle-orm';
import { generateSlug } from '../src/lib/utils/slug';

async function main() {
    console.log("Starting slug backfill...");

    // Fetch projects without slugs
    const projectsWithoutSlug = await db.select().from(projects).where(isNull(projects.slug));

    console.log(`Found ${projectsWithoutSlug.length} projects to update.`);

    for (const project of projectsWithoutSlug) {
        const newSlug = generateSlug(project.title);
        console.log(`Updating "${project.title}" -> ${newSlug}`);

        await db.update(projects)
            .set({ slug: newSlug })
            .where(eq(projects.id, project.id));
    }

    console.log("Backfill complete.");
    process.exit(0);
}

main().catch(console.error);
