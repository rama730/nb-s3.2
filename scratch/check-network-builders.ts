import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv();

import { sql } from "drizzle-orm";

async function main() {
    const { db } = await import("../src/lib/db");
    const { projects, projectMembers, connections, profiles, projectOpenRoles, roleApplications } = await import("../src/lib/db/schema");
    const { eq, and, or } = await import("drizzle-orm");

    const slug = "network-for-builders";
    const userId = "2b4030a1-b030-4a50-811a-0da96b88c224";

    // 1. Fetch project by slug
    const [project] = await db.select().from(projects).where(eq(projects.slug, slug));
    if (!project) {
        console.log(`Project with slug ${slug} not found.`);
        process.exit(1);
    }
    const projectId = project.id;

    // 1. Fetch project open roles that are not fully filled
    const openRoles = await db.query.projectOpenRoles.findMany({
        where: and(
            eq(projectOpenRoles.projectId, projectId),
            sql`${projectOpenRoles.filled} < ${projectOpenRoles.count}`
        ),
    });

    // 2. Fetch all project member user IDs (to exclude them from connections list)
    const members = await db.query.projectMembers.findMany({
        where: eq(projectMembers.projectId, projectId),
        columns: { userId: true },
    });
    const memberUserIds = new Set(members.map((m) => m.userId));

    // 3. Fetch all pending applications for this project
    const pendingApps = await db.query.roleApplications.findMany({
        where: and(
            eq(roleApplications.projectId, projectId),
            eq(roleApplications.status, 'pending')
        ),
        columns: { id: true, applicantId: true, roleId: true },
    });
    const pendingAppsByApplicant = new Map(
        pendingApps.map((app) => [app.applicantId, app])
    );

    // 4. Fetch all accepted connections of the user
    const connectionRows = await db
        .select({
            id: connections.id,
            requesterId: connections.requesterId,
            addresseeId: connections.addresseeId,
            profileId: profiles.id,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
            headline: profiles.headline,
        })
        .from(connections)
        .innerJoin(
            profiles,
            or(
                and(
                    eq(connections.requesterId, userId),
                    eq(connections.addresseeId, profiles.id)
                ),
                and(
                    eq(connections.addresseeId, userId),
                    eq(connections.requesterId, profiles.id)
                )
            )
        )
        .where(
            and(
                eq(connections.status, 'accepted'),
                or(eq(connections.requesterId, userId), eq(connections.addresseeId, userId))
            )
        );

    // Map and filter out existing members
    const filteredConnections = connectionRows
        .filter((row) => !memberUserIds.has(row.profileId))
        .map((row) => {
            const pendingApp = pendingAppsByApplicant.get(row.profileId);
            return {
                id: row.profileId,
                username: row.username,
                fullName: row.fullName,
                avatarUrl: row.avatarUrl,
                headline: row.headline,
                pendingApplicationId: pendingApp?.id || null,
                pendingApplicationRoleId: pendingApp?.roleId || null,
            };
        });

    console.log("memberUserIds:", Array.from(memberUserIds));
    console.log("connections count:", connectionRows.length);
    console.log("filteredConnections count:", filteredConnections.length);
    console.log("filteredConnections:", filteredConnections);
    console.log("openRoles:", openRoles);

    process.exit(0);
}

main().catch(console.error);
