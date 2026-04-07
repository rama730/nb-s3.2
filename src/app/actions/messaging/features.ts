'use server';

import { db } from '@/lib/db';
import {
    messageReactions,
    messageReports,
    messageReadReceipts,
    conversationParticipants,
    messages,
    profiles,
} from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import {
    buildReactionSummaryByMessage,
    type MessageReactionSummary,
    withReactionSummaryMetadata,
} from '@/lib/messages/reactions';

// Auth helper — same pattern as _all.ts
async function getAuthUser() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
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
        if (!emoji || emoji.length > 8) return { success: false, error: 'Invalid emoji' };

        // Check message exists
        const [messageRow] = await db
            .select({
                id: messages.id,
                conversationId: messages.conversationId,
                deletedAt: messages.deletedAt,
            })
            .from(messages)
            .where(eq(messages.id, messageId))
            .limit(1);

        if (!messageRow || messageRow.deletedAt) {
            return { success: false, error: 'Message not found' };
        }

        // Verify user is a participant in this conversation
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

        // Check if reaction already exists
        const [existing] = await db
            .select({ id: messageReactions.id })
            .from(messageReactions)
            .where(
                and(
                    eq(messageReactions.messageId, messageId),
                    eq(messageReactions.userId, user.id),
                    eq(messageReactions.emoji, emoji)
                )
            )
            .limit(1);

        if (existing) {
            // Remove reaction
            await db.delete(messageReactions).where(eq(messageReactions.id, existing.id));
        } else {
            // Add reaction
            await db.insert(messageReactions).values({
                messageId,
                userId: user.id,
                emoji,
            });
        }

        const rows = await db
            .select({
                messageId: messageReactions.messageId,
                emoji: messageReactions.emoji,
                userId: messageReactions.userId,
            })
            .from(messageReactions)
            .where(eq(messageReactions.messageId, messageId));

        const reactionSummary = buildReactionSummaryByMessage(rows, user.id)[messageId] || [];
        await db.update(messages)
            .set({
                metadata: reactionSummary.length > 0
                    ? sql`coalesce(${messages.metadata}, '{}'::jsonb) || ${JSON.stringify({
                        reactionSummary: withReactionSummaryMetadata({}, reactionSummary).reactionSummary,
                    })}::jsonb`
                    : sql`coalesce(${messages.metadata}, '{}'::jsonb) - 'reactionSummary'`,
            })
            .where(eq(messages.id, messageId));

        return { success: true, added: !existing, reactionSummary };
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

        const rows = await db
            .select({
                messageId: messageReactions.messageId,
                emoji: messageReactions.emoji,
                userId: messageReactions.userId,
            })
            .from(messageReactions)
            .where(inArray(messageReactions.messageId, messageIds));

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
// READ RECEIPTS
// ============================================================================

/**
 * Record read receipts for a batch of message IDs.
 * Called when the user reads messages in a conversation.
 */
export async function recordReadReceipts(
    messageIds: string[]
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        if (!messageIds.length) return { success: true };

        // Clamp to 50 messages per batch
        const batch = messageIds.slice(0, 50);

        // Insert read receipts, ignoring duplicates
        await db.insert(messageReadReceipts)
            .values(batch.map((messageId) => ({
                messageId,
                userId: user.id,
            })))
            .onConflictDoNothing();

        return { success: true };
    } catch (error) {
        console.error('Error recording read receipts:', error);
        return { success: false, error: 'Failed to record read receipts' };
    }
}

/**
 * Get read receipts for a specific message. Returns who has read it.
 */
export async function getMessageReadReceipts(
    messageId: string
): Promise<{ success: boolean; error?: string; readBy?: Array<{ id: string; username: string | null; fullName: string | null; avatarUrl: string | null; readAt: Date }> }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const rows = await db
            .select({
                userId: messageReadReceipts.userId,
                readAt: messageReadReceipts.readAt,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
            })
            .from(messageReadReceipts)
            .innerJoin(profiles, eq(messageReadReceipts.userId, profiles.id))
            .where(eq(messageReadReceipts.messageId, messageId))
            .orderBy(desc(messageReadReceipts.readAt))
            .limit(50);

        return {
            success: true,
            readBy: rows.map((r) => ({
                id: r.userId,
                username: r.username,
                fullName: r.fullName,
                avatarUrl: r.avatarUrl,
                readAt: r.readAt,
            })),
        };
    } catch (error) {
        console.error('Error getting read receipts:', error);
        return { success: false, error: 'Failed to get read receipts' };
    }
}

// ============================================================================
// CONVERSATION PINNING
// ============================================================================

/**
 * Pin or unpin a conversation for the current user.
 */
export async function setConversationPinned(
    conversationId: string,
    pinned: boolean
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const { allowed } = await consumeRateLimit(`pin:${user.id}`, 60, 60);
        if (!allowed) return { success: false, error: 'Rate limit exceeded' };

        await db
            .update(conversationParticipants)
            .set({ pinnedAt: pinned ? new Date() : null })
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, user.id)
                )
            );

        return { success: true };
    } catch (error) {
        console.error('Error pinning conversation:', error);
        return { success: false, error: 'Failed to pin conversation' };
    }
}
