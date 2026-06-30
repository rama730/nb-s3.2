import { db } from './src/lib/db';
import { messageWorkLinks } from './src/lib/db/schema';
import { eq, inArray, isNull, and, or } from 'drizzle-orm';

async function main() {
    try {
        const uniqueMessageIds = ['not-a-uuid-1234'];
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
        console.log("ERROR STRING:", String(err));
    }
    process.exit(0);
}
main();
