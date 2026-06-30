import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv();

async function main() {
    const { db } = await import("../src/lib/db");
    const { projectReadmes, projectReadmeVersions, profiles } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    const projectId = "0adb0049-a58e-44d3-bcb3-db2ee4abdfc6";

    // Fetch README
    const [readme] = await db.select().from(projectReadmes).where(eq(projectReadmes.projectId, projectId));
    if (!readme) {
        console.log("No README found");
        process.exit(0);
    }

    console.log("README details:");
    console.log(`- Published Version ID: ${readme.publishedVersionId}`);

    if (readme.publishedVersionId) {
        const [version] = await db.select().from(projectReadmeVersions).where(eq(projectReadmeVersions.id, readme.publishedVersionId));
        if (version) {
            const [creator] = await db.select().from(profiles).where(eq(profiles.id, version.createdBy || ""));
            console.log(`- Version Number: ${version.versionNumber}`);
            console.log(`- Created By: ${version.createdBy} (${creator?.fullName || creator?.username || 'unknown'})`);
            console.log(`- Content:\n---`);
            console.log(version.content);
            console.log(`---`);
        } else {
            console.log("Published version record not found");
        }
    }

    process.exit(0);
}

main().catch(console.error);
