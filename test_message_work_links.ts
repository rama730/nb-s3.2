import { db } from './src/lib/db';
import { messageWorkLinks } from './src/lib/db/schema';
import { eq, inArray, isNull, and, or } from 'drizzle-orm';

async function main() {
    try {
        const uniqueMessageIds = Array.from({ length: 18 }, (_, i) => `5cc995bb-eb3f-42a9-9520-22cba2b52${i.toString().padStart(3, '0')}`);
        const conversationId = '8902de73-3905-4f84-9ec7-6a700941cd1c';
        const userId = '1a00a13d-51a8-444a-a0f5-ef80053702a0';
        
        await db
            .select()
            .from(messageWorkLinks)
            .where(and(
                eq(messageWorkLinks.sourceConversationId, conversationId),
                inArray(messageWorkLinks.sourceMessageId, uniqueMessageIds),
                isNull(messageWorkLinks.deletedAt),
                or(
                    eq(messageWorkLinks.visibility, "shared" as any),
                    eq(messageWorkLinks.ownerUserId, userId),
                    eq(messageWorkLinks.createdBy, userId),
                ),
            ))
            .orderBy(messageWorkLinks.updatedAt);
        console.log("Success");
    } catch (err: any) {
        console.log("ERROR MESSAGE:", err.message);
        console.log("ERROR NAME:", err.name);
        console.log("ERROR CODE:", err.code);
    }
    process.exit(0);
}
main();
