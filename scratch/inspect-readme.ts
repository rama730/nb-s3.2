import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv();

async function main() {
    const { db } = await import("../src/lib/db");
    const { projectReadmes, projectReadmeVersions } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    const projectId = "c5a7fa11-bacb-4a58-bc3a-280ad9668b44";
    const [readme] = await db.select().from(projectReadmes).where(eq(projectReadmes.projectId, projectId));
    
    if (!readme) {
        console.log(`No README record found for project ${projectId}`);
        process.exit(0);
    }

    console.log(`README found for project ${projectId}:`);
    console.log(`- ID: ${readme.id}`);
    console.log(`- Draft Content Length: ${readme.draftContent?.length ?? 0} chars`);
    console.log(`- Published Version ID: ${readme.publishedVersionId ?? "none"}`);

    const versions = await db.select().from(projectReadmeVersions).where(eq(projectReadmeVersions.projectId, projectId));
    console.log(`- Versions count: ${versions.length}`);
    for (const v of versions) {
        console.log(`  * Version ID: ${v.id}, Version Number: ${v.versionNumber}, Content Length: ${v.content?.length ?? 0} chars`);
    }

    // If draft is empty but a published version exists, let's restore it!
    const activeVersionId = readme.publishedVersionId;
    if (readme.draftContent?.length === 0 && activeVersionId) {
        const [activeVersion] = await db.select().from(projectReadmeVersions).where(eq(projectReadmeVersions.id, activeVersionId));
        if (activeVersion && activeVersion.content) {
            console.log(`\nRestoring draft content from published version ${activeVersionId} (${activeVersion.content.length} chars)...`);
            await db.update(projectReadmes)
                .set({
                    draftContent: activeVersion.content,
                    draftUpdatedAt: new Date(),
                    updatedAt: new Date()
                })
                .where(eq(projectReadmes.id, readme.id));
            console.log("Restored!");
        }
    } else if (readme.draftContent?.length === 0 && versions.length > 0) {
        // If there's no active published version but there's a version in history, restore the latest one
        const latestVersion = versions.sort((a, b) => b.versionNumber - a.versionNumber)[0];
        if (latestVersion && latestVersion.content) {
            console.log(`\nRestoring draft content from latest version in history ${latestVersion.id} (${latestVersion.content.length} chars)...`);
            await db.update(projectReadmes)
                .set({
                    draftContent: latestVersion.content,
                    draftUpdatedAt: new Date(),
                    updatedAt: new Date()
                })
                .where(eq(projectReadmes.id, readme.id));
            console.log("Restored!");
        }
    }

    process.exit(0);
}

main().catch(console.error);
