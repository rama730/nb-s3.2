import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv();

async function main() {
    const { db } = await import("../src/lib/db");
    const { projects, projectMembers, projectReadmes, profiles } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const { resolveProjectReadmePermission } = await import("../src/lib/projects/readme");

    const projectId = "0adb0049-a58e-44d3-bcb3-db2ee4abdfc6";

    // 1. Fetch project
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) {
        console.log(`Project ${projectId} not found.`);
        process.exit(1);
    }
    console.log("PROJECT:");
    console.log(`- Slug: ${project.slug}`);
    console.log(`- Title: ${project.title}`);
    console.log(`- Owner ID: ${project.ownerId}`);
    console.log(`- Visibility: ${project.visibility}`);
    console.log(`- Public Tab Visibility:`, project.publicTabVisibility);

    // 2. Fetch README
    const [readme] = await db.select().from(projectReadmes).where(eq(projectReadmes.projectId, projectId));
    if (readme) {
        console.log("\nREADME:");
        console.log(`- ID: ${readme.id}`);
        console.log(`- Settings:`, readme.settings);
        console.log(`- Published Version ID: ${readme.publishedVersionId}`);
    } else {
        console.log("\nREADME: None");
    }

    // 3. Fetch project members
    const members = await db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId));
    console.log(`\nMEMBERS (${members.length}):`);
    for (const m of members) {
        const [profile] = await db.select().from(profiles).where(eq(profiles.id, m.userId));
        console.log(`- User ID: ${m.userId} (${profile?.fullName || profile?.username || 'No profile'}), Role: ${m.role}`);
        
        // Let's resolve permissions for this user
        const permission = resolveProjectReadmePermission({
            actorUserId: m.userId,
            projectVisibility: project.visibility,
            publicTabVisibility: project.publicTabVisibility,
            settings: readme?.settings,
            membershipRole: m.role,
            isOwner: m.userId === project.ownerId,
            isActiveMember: true,
            hasPublishedReadme: Boolean(readme?.publishedVersionId),
        });
        console.log("  Permission Resolver Output:", permission);
    }

    process.exit(0);
}

main().catch(console.error);
