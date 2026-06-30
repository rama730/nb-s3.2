import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv();

async function main() {
    const { db } = await import("../src/lib/db");
    const { projectReadmes, projectReadmeVersions } = await import("../src/lib/db/schema");
    const { eq, desc } = await import("drizzle-orm");

    const projectId = "0adb0049-a58e-44d3-bcb3-db2ee4abdfc6";

    const [readme] = await db.select().from(projectReadmes).where(eq(projectReadmes.projectId, projectId));
    if (!readme) {
        console.log("No README row found.");
        process.exit(0);
    }

    console.log("DATABASE README ROW:");
    console.log("- ID:", readme.id);
    console.log("- Draft content length:", readme.draftContent?.length ?? 0);
    console.log("- Draft updated at:", readme.draftUpdatedAt);
    console.log("- Draft updated by:", readme.draftUpdatedBy);
    console.log("- Published version ID:", readme.publishedVersionId);

    const versions = await db.select().from(projectReadmeVersions).where(eq(projectReadmeVersions.projectId, projectId)).orderBy(desc(projectReadmeVersions.versionNumber));
    console.log(`\nVERSIONS (${versions.length}):`);
    for (const v of versions) {
        console.log(`- Version #${v.versionNumber}: ID=${v.id}, CreatedBy=${v.createdBy}, CreatedAt=${v.createdAt}, ContentHash=${v.contentHash}, ContentLength=${v.content?.length ?? 0}`);
    }

    process.exit(0);
}

main().catch(console.error);
