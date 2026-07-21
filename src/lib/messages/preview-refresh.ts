import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
    conversationParticipants,
    messageHiddenForUsers,
    messages,
} from '@/lib/db/schema';
import { buildConversationParticipantPreview } from '@/lib/messages/preview-authority';

export async function conversationNeedsPreviewRefresh(
    conversationId: string,
    messageId: string,
) {
    const [row] = await db
        .select({ id: conversationParticipants.id })
        .from(conversationParticipants)
        .where(
            and(
                eq(conversationParticipants.conversationId, conversationId),
                eq(conversationParticipants.lastMessageId, messageId),
            ),
        )
        .limit(1);

    return Boolean(row);
}

export async function refreshConversationParticipantPreviews(conversationId: string) {
    const participants = await db
        .select({
            id: conversationParticipants.id,
            userId: conversationParticipants.userId,
        })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.conversationId, conversationId));

    await Promise.all(participants.map(async (participant) => {
        const [latestMessage] = await db
            .select({
                id: messages.id,
                content: messages.content,
                type: messages.type,
                metadata: messages.metadata,
                createdAt: messages.createdAt,
                senderId: messages.senderId,
            })
            .from(messages)
            .where(
                and(
                    eq(messages.conversationId, conversationId),
                    isNull(messages.deletedAt),
                    sql`NOT EXISTS (
                        SELECT 1
                        FROM ${messageHiddenForUsers} h
                        WHERE h.message_id = ${messages.id}
                          AND h.user_id = ${participant.userId}
                    )`,
                ),
            )
            .orderBy(desc(messages.createdAt), desc(messages.id))
            .limit(1);

        await db
            .update(conversationParticipants)
            .set(buildConversationParticipantPreview(
                latestMessage
                    ? {
                        ...latestMessage,
                        metadata: latestMessage.metadata as Record<string, unknown> | null,
                    }
                    : null,
            ))
            .where(eq(conversationParticipants.id, participant.id));
    }));
}

export async function refreshConversationParticipantPreviewsIfNeeded(
    conversationId: string,
    messageId: string,
) {
    if (await conversationNeedsPreviewRefresh(conversationId, messageId)) {
        await refreshConversationParticipantPreviews(conversationId);
    }
}
