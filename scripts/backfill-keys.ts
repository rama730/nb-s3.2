import { config } from 'dotenv';
config({ path: '.env.local' });

if (process.env.DATABASE_URL) {
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace('localhost', '127.0.0.1');
}

import { db } from "../src/lib/db";
import { projects, tasks } from "../src/lib/db/schema";
import { eq, isNull } from "drizzle-orm";
import { generateProjectKey } from "../src/lib/project-key";

async function main() {
    console.log("Starting backfill...");

    // 1. Backfill Project Keys
    const allProjects = await db.select().from(projects);
    for (const project of allProjects) {
        if (!project.key) {
            const key = generateProjectKey(project.title);
            console.log(`Generating key for project "${project.title}": ${key}`);
            await db.update(projects).set({ key }).where(eq(projects.id, project.id));
        }
    }

    // 2. Backfill Task Numbers
    // For each project, order tasks by creation date and assign numbers
    for (const project of allProjects) {
        const projectTasks = await db.select()
            .from(tasks)
            .where(eq(tasks.projectId, project.id))
            .orderBy(tasks.createdAt);

        console.log(`Processing ${projectTasks.length} tasks for project ${project.title}`);

        let counter = 1;
        for (const task of projectTasks) {
            if (!task.taskNumber) {
                await db.update(tasks)
                    .set({ taskNumber: counter })
                    .where(eq(tasks.id, task.id));
                counter++;
            } else {
                // Even if it has a number, ensure counter keeps up if we are re-running?
                // Assuming partial migration: if taskNumber exists, use it?
                // For now, let's just assume we are filling nulls. 
                // But wait, if we mix modes, we need strict ordering.
                // Let's just re-number everything to be safe and clean.
                await db.update(tasks)
                    .set({ taskNumber: counter })
                    .where(eq(tasks.id, task.id));
                counter++;
            }
        }

        // Update Project Counter
        await db.update(projects)
            .set({ currentTaskNumber: counter - 1 })
            .where(eq(projects.id, project.id));
    }

    console.log("Backfill complete!");
    process.exit(0);
}

main().catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
});
