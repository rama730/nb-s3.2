import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

export async function refreshConversationParticipantPreviews(conversationId: string) {
    await db.execute(sql`
        SELECT app_private.nb_reconcile_conversation_participants(
            ${conversationId}::uuid,
            NULL::uuid
        )
    `);
}
