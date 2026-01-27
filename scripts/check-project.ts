import 'dotenv/config';
import { db } from '../src/lib/db';
import { projects } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
    const ids = ['b0165d09-293c-449c-bed0-3c3109cca31b'];
    console.log("Checking IDs:", ids);

    for (const id of ids) {
        console.log(`Checking ID: ${id}`);
        const result = await db.query.projects.findFirst({
            where: eq(projects.id, id)
        });
        console.log(`Result for ${id}:`, result ? "FOUND" : "NOT FOUND");
        if (result) {
            console.log("Title:", result.title);
            console.log("Owner ID:", result.ownerId);
            console.log("Slug:", result.slug);
        }
    }
    process.exit(0);
}

main().catch(console.error);
