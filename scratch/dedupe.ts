import { db } from "../src/lib/db";
import { projectReadmes } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Fetching all readmes...");
    const readmes = await db.select().from(projectReadmes);
    for (const readme of readmes) {
        if (readme.draftContent && readme.draftContent.length > 2000) {
            console.log(`Found large draft for ${readme.projectId}: ${readme.draftContent.length} chars`);
            const marker = "# Pre-commit hooks configuration";
            const firstIndex = readme.draftContent.indexOf(marker);
            if (firstIndex !== -1) {
                const secondIndex = readme.draftContent.indexOf(marker, firstIndex + marker.length);
                if (secondIndex !== -1) {
                    console.log(`Duplication detected. Truncating from ${readme.draftContent.length} to ${secondIndex}`);
                    const deduplicated = readme.draftContent.substring(0, secondIndex);
                    await db.update(projectReadmes)
                        .set({ draftContent: deduplicated })
                        .where(eq(projectReadmes.id, readme.id));
                    console.log("Fixed!");
                }
            }
        }
    }
    process.exit(0);
}
main().catch(console.error);
