import { db } from "../src/lib/db";
import { connections, profiles } from "../src/lib/db/schema";
import { eq, or, and } from "drizzle-orm";

async function main() {
    const userId = "2b4030a1-b030-4a50-811a-0da96b88c224";

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

    console.log("Connection rows count:", connectionRows.length);
    console.log("Connection rows:", connectionRows);
}

main().catch(console.error);
