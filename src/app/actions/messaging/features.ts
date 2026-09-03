'use server';

import { db } from '@/lib/db';
import {
    messageReactions,
    messageReports,
    messageDeliveryReceipts,
    messageReadReceipts,
    messageHiddenForUsers,
    conversationParticipants,
    messages,
    profiles,
} from '@/lib/db/schema';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { eq, and, inArray, lt, sql } from 'drizzle-orm';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import {
    buildReactionSummaryByMessage,
    type MessageReactionSummary,
} from '@/lib/messages/reactions';
import { emitMessageReactionNotification } from '@/lib/notifications/emitters';

async function listAccessibleMessages(messageIds: string[], userId: string) {
    const uniqueIds = Array.from(new Set(messageIds.filter(Boolean)));
    if (uniqueIds.length === 0) return [];

    return db
        .select({
            id: messages.id,
            conversationId: messages.conversationId,
            senderId: messages.senderId,
        })
        .from(messages)
        .innerJoin(
            conversationParticipants,
            and(
                eq(conversationParticipants.conversationId, messages.conversationId),
                eq(conversationParticipants.userId, userId),
            ),
        )
        .where(and(
            inArray(messages.id, uniqueIds),
            sql`NOT EXISTS (
                SELECT 1
                FROM ${messageHiddenForUsers} hidden
                WHERE hidden.message_id = ${messages.id}
                  AND hidden.user_id = ${userId}
            )`,
        ));
}

async function assertMessageAccess(messageId: string, userId: string) {
    const [messageRow] = await listAccessibleMessages([messageId], userId);
    return messageRow ?? null;
}

// ============================================================================
// REACTIONS
// ============================================================================

export type ReactionSummary = MessageReactionSummary;

/**
 * Toggle a reaction on a message. If the user already reacted with this emoji,
 * remove it. Otherwise, add it.
 */
export async function toggleReaction(
    messageId: string,
    emoji: string
): Promise<{ success: boolean; error?: string; added?: boolean; reactionSummary?: ReactionSummary[] }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        // Rate limit: 120 reactions per minute
        const { allowed } = await consumeRateLimit(`reactions:${user.id}`, 120, 60);
        if (!allowed) return { success: false, error: 'Rate limit exceeded' };

        // Validate emoji (must be 1-8 chars, basic protection)
        const normalizedEmoji = emoji?.trim();
        if (!normalizedEmoji || normalizedEmoji.length > 8) {
            return { success: false, error: 'Invalid emoji' };
        }

        let pendingNotification: Parameters<typeof emitMessageReactionNotification>[0] | null = null;

        const txResult = await db.transaction(async (tx) => {
            await tx.execute(sql`
                SELECT pg_advisory_xact_lock(
                    hashtextextended(${`${messageId}:${user.id}`}, 0)
                )
            `);

            const [messageRow] = await tx
                .select({
                    id: messages.id,
                    conversationId: messages.conversationId,
                    senderId: messages.senderId,
                    deletedAt: messages.deletedAt,
                })
                .from(messages)
                .innerJoin(
                    conversationParticipants,
                    and(
                        eq(conversationParticipants.conversationId, messages.conversationId),
                        eq(conversationParticipants.userId, user.id),
                    ),
                )
                .where(and(
                    eq(messages.id, messageId),
                    sql`NOT EXISTS (
                        SELECT 1
                        FROM ${messageHiddenForUsers} hidden
                        WHERE hidden.message_id = ${messages.id}
                          AND hidden.user_id = ${user.id}
                    )`,
                ))
                .limit(1);

            if (!messageRow || messageRow.deletedAt) {
                return { success: false, error: 'Message not found' };
            }

            const [existingReaction] = await tx
                .select({ id: messageReactions.id, emoji: messageReactions.emoji })
                .from(messageReactions)
                .where(and(
                    eq(messageReactions.messageId, messageId),
                    eq(messageReactions.userId, user.id),
                ))
                .limit(1);

            const added = existingReaction?.emoji !== normalizedEmoji;
            if (existingReaction?.emoji === normalizedEmoji) {
                await tx
                    .delete(messageReactions)
                    .where(eq(messageReactions.id, existingReaction.id));
            } else if (existingReaction) {
                await tx
                    .update(messageReactions)
                    .set({ emoji: normalizedEmoji, createdAt: new Date() })
                    .where(eq(messageReactions.id, existingReaction.id));
            } else {
                await tx.insert(messageReactions).values({
                    messageId,
                    conversationId: messageRow.conversationId,
                    userId: user.id,
                    emoji: normalizedEmoji,
                });
            }

            if (added && messageRow.senderId && messageRow.senderId !== user.id) {
                const now = new Date();
                const [[recipient], [actor]] = await Promise.all([
                    tx
                        .select({ muted: conversationParticipants.muted })
                        .from(conversationParticipants)
                        .where(and(
                            eq(conversationParticipants.conversationId, messageRow.conversationId),
                            eq(conversationParticipants.userId, messageRow.senderId),
                        ))
                        .limit(1),
                    tx
                        .select({ fullName: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl })
                        .from(profiles)
                        .where(eq(profiles.id, user.id))
                        .limit(1),
                ]);

                await tx
                    .update(conversationParticipants)
                    .set({
                        lastReactionAt: now,
                        lastReactionMessageId: messageRow.id,
                        lastReactionEmoji: normalizedEmoji,
                        lastReactionActorId: user.id,
                    })
                    .where(and(
                        eq(conversationParticipants.conversationId, messageRow.conversationId),
                        eq(conversationParticipants.userId, messageRow.senderId),
                    ));

                pendingNotification = {
                    recipientUserId: messageRow.senderId,
                    recipientMuted: recipient?.muted,
                    actorUserId: user.id,
                    actorName: actor?.fullName || actor?.username || null,
                    actorAvatarUrl: actor?.avatarUrl ?? null,
                    conversationId: messageRow.conversationId,
                    sourceMessageId: messageRow.id,
                    emoji: normalizedEmoji,
                };
            }

            const rows = await tx
                .select({
                    messageId: messageReactions.messageId,
                    emoji: messageReactions.emoji,
                    userId: messageReactions.userId,
                })
                .from(messageReactions)
                .where(eq(messageReactions.messageId, messageId));
            const reactionSummary = buildReactionSummaryByMessage(rows, user.id)[messageId] || [];

            return { success: true, added, reactionSummary };
        });

        if (pendingNotification) {
            void emitMessageReactionNotification(pendingNotification).catch((err) => {
                console.error('Failed to emit reaction notification:', err);
            });
        }

        return txResult;
    } catch (error) {
        console.error('Error toggling reaction:', error);
        return { success: false, error: 'Failed to toggle reaction' };
    }
}

/**
 * Get all reactions for a set of message IDs, grouped by emoji with counts.
 */
export async function getMessageReactions(
    messageIds: string[]
): Promise<{ success: boolean; error?: string; reactions?: Record<string, ReactionSummary[]> }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        if (!messageIds.length || messageIds.length > 100) {
            return { success: true, reactions: {} };
        }

        const accessibleMessages = await listAccessibleMessages(messageIds.slice(0, 100), user.id);
        if (accessibleMessages.length === 0) {
            return { success: true, reactions: {} };
        }

        const rows = await db
            .select({
                messageId: messageReactions.messageId,
                emoji: messageReactions.emoji,
                userId: messageReactions.userId,
            })
            .from(messageReactions)
            .where(inArray(messageReactions.messageId, accessibleMessages.map((message) => message.id)));

        return { success: true, reactions: buildReactionSummaryByMessage(rows, user.id) };
    } catch (error) {
        console.error('Error getting reactions:', error);
        return { success: false, error: 'Failed to get reactions' };
    }
}

// ============================================================================
// REPORTS
// ============================================================================

/**
 * Report a message for abuse/spam/etc.
 */
export async function reportMessage(
    messageId: string,
    reason: 'spam' | 'harassment' | 'hate_speech' | 'inappropriate' | 'other',
    details?: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        // Rate limit: 10 reports per hour
        const { allowed } = await consumeRateLimit(`reports:${user.id}`, 10, 3600);
        if (!allowed) return { success: false, error: 'Rate limit exceeded' };

        // Check message exists
        const [messageRow] = await db
            .select({ id: messages.id, conversationId: messages.conversationId, senderId: messages.senderId })
            .from(messages)
            .where(eq(messages.id, messageId))
            .limit(1);

        if (!messageRow) {
            return { success: false, error: 'Message not found' };
        }

        // Cannot report own messages
        if (messageRow.senderId === user.id) {
            return { success: false, error: 'Cannot report your own message' };
        }

        // Verify user is a participant
        const [membership] = await db
            .select({ id: conversationParticipants.id })
            .from(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, messageRow.conversationId),
                    eq(conversationParticipants.userId, user.id)
                )
            )
            .limit(1);

        if (!membership) {
            return { success: false, error: 'Not authorized' };
        }

        // Clamp details length
        const clampedDetails = details?.slice(0, 1000) || null;

        // Insert report (unique constraint handles duplicates)
        await db.insert(messageReports).values({
            messageId,
            conversationId: messageRow.conversationId,
            reporterId: user.id,
            reason,
            details: clampedDetails,
        }).onConflictDoNothing();

        return { success: true };
    } catch (error) {
        console.error('Error reporting message:', error);
        return { success: false, error: 'Failed to report message' };
    }
}

// ============================================================================
// DELIVERY RECEIPTS
// ============================================================================

/**
 * Record delivery receipts for a batch of message IDs.
 * Called when the recipient's client receives new messages via realtime.
 * Drives the WhatsApp-style double gray tick (✓✓).
 */
export async function recordDeliveryReceipts(
    messageIds: string[]
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        if (!messageIds.length) return { success: true };

        if (messageIds.length > 100) {
            return { success: false, error: 'Too many receipt IDs; maximum is 100' };
        }
        const batch = Array.from(new Set(messageIds.filter(Boolean)));

        // Look up messages with sender IDs so we can filter out the caller's
        // own messages (you can't deliver a message to yourself) and confirm
        // the caller is a participant of each conversation.
        const accessibleRows = await db
            .select({
                id: messages.id,
                conversationId: messages.conversationId,
                senderId: messages.senderId,
            })
            .from(messages)
            .innerJoin(
                conversationParticipants,
                and(
                    eq(conversationParticipants.conversationId, messages.conversationId),
                    eq(conversationParticipants.userId, user.id),
                ),
            )
            .where(inArray(messages.id, batch));

        if (accessibleRows.length !== batch.length) {
            return { success: false, error: 'Not authorized' };
        }
        const otherMessages = accessibleRows.filter((row) => row.senderId !== user.id);
        if (otherMessages.length === 0) return { success: true };

        // Insert delivery receipts, ignoring duplicates
        await db.insert(messageDeliveryReceipts)
            .values(otherMessages.map((message) => ({
                messageId: message.id,
                conversationId: message.conversationId,
                userId: user.id,
            })))
            .onConflictDoNothing();

        return { success: true };
    } catch (error) {
        console.error('Error recording delivery receipts:', error);
        return { success: false, error: 'Failed to record delivery receipts' };
    }
}

/**
 * Prunes delivery and read receipts older than retentionDays (default: 60 days).
 * Prevents unbounded row growth in receipt tables under 1M-scale messaging.
 */
export async function pruneOldMessageReceipts(
    retentionDays = 60,
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) {
            return { success: false, error: 'Unauthorized' };
        }

        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

        await Promise.all([
            db.delete(messageDeliveryReceipts).where(lt(messageDeliveryReceipts.deliveredAt, cutoff)),
            db.delete(messageReadReceipts).where(lt(messageReadReceipts.readAt, cutoff)),
        ]);

        return { success: true };
    } catch (error) {
        console.error('Error pruning old message receipts:', error);
        return { success: false, error: 'Failed to prune receipts' };
    }
}
