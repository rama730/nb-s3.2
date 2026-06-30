import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv();

async function main() {
    const { db } = await import("../src/lib/db");
    const { projectReadmeVersions } = await import("../src/lib/db/schema");
    const { eq, inArray } = await import("drizzle-orm");

    const ids = [
        "16cda1d7-80f5-4721-a487-e4e48fc371e7", // v8
        "634794c8-0a08-4aef-afda-521c755074de", // v7
        "f13bea7b-dcd5-46fc-aebe-40704c53918e", // v6
        "2b69a0fc-33c0-4d2b-8c44-e62d55e02a37",  // v5
        "c7f8d2a5-4850-4753-abd3-35ef4453389c"   // v4
    ];

    const versions = await db.select().from(projectReadmeVersions).where(inArray(projectReadmeVersions.id, ids));
    for (const v of versions) {
        console.log(`\n--- VERSION ID: ${v.id} (Version #${v.versionNumber}) ---`);
        console.log(v.content);
    }
    process.exit(0);
}

main().catch(console.error);
