import { db } from "../src/lib/db";
import { connections, profiles } from "../src/lib/db/schema";
import { eq, or, and } from "drizzle-orm";

async function main() {
    // Let's find some profiles
    const allProfiles = await db.select({ id: profiles.id, username: profiles.username, fullName: profiles.fullName }).from(profiles).limit(5);
    console.log("Profiles in system:", allProfiles);

    // Let's find all connections
    const allConns = await db.select().from(connections).limit(10);
    console.log("Connections in system:", allConns);
}

main().catch(console.error);
