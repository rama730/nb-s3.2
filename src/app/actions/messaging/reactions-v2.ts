'use server';

import { db } from '@/lib/db';
import {
    messageReactions,
    conversationParticipants,
    messages,
} from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq, and, sql } from 'drizzle-orm';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import {
    buildReactionSummaryByMessage,
    toPersistedReactionSummary,
    type MessageReactionSummary,
} from '@/lib/messages/reactions';

async function getAuthUser() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

/**
 * Toggle a reaction on a message using the dedicated `message_reactions` table.
 *
 * Bug Condition: isBugCondition(input) where input.type == 'REACTION_TOGGLED'
 * Expected Behavior: Reaction persisted in dedicated table with per-user attribution.
 * Preservation: Backward-compatible reactionSummary JSONB still updated for existing consumers.
 *
 * Steps:
 * 1. Authenticate the user
 * 2. Check if the reaction already exists in `message_reactions`
 * 3. If exists: DELETE it (toggle off)
 * 4. If not exists: INSERT it (toggle on)
 * 5. Recompute the `metadata.reactionSummary` JSONB on the message row (backward compatibility)
 * 6. Return the updated reaction summary
 */
export async function toggleReactionV2(
    messageId: string,
    emoji: string,
): Promise<{
    success: boolean;
    error?: string;
    added?: boolean;
    reactionSummary?: MessageReactionSummary[];
}> {
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

        // Check message exists and is not deleted
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
                    eq(conversationParticipants.userId, user.id),
                ),
            )
            .limit(1);

        if (!membership) {
            return { success: false, error: 'Not authorized' };
        }

        // Check if reaction already exists in the dedicated table
        const [existing] = await db
            .select({ id: messageReactions.id })
            .from(messageReactions)
            .where(
                and(
                    eq(messageReactions.messageId, messageId),
                    eq(messageReactions.userId, user.id),
                    eq(messageReactions.emoji, normalizedEmoji),
                ),
            )
            .limit(1);

        if (existing) {
            // Toggle off: DELETE the reaction
            await db.delete(messageReactions).where(eq(messageReactions.id, existing.id));
        } else {
            // Toggle on: INSERT the reaction
            await db.insert(messageReactions).values({
                messageId,
                userId: user.id,
                emoji: normalizedEmoji,
            });
        }

        // Recompute reactionSummary from all reactions for this message
        const rows = await db
            .select({
                messageId: messageReactions.messageId,
                emoji: messageReactions.emoji,
                userId: messageReactions.userId,
            })
            .from(messageReactions)
            .where(eq(messageReactions.messageId, messageId));

        const reactionSummary = buildReactionSummaryByMessage(rows, user.id)[messageId] || [];

        // Update the message metadata.reactionSummary for backward compatibility
        // This ensures existing consumers that read from the JSONB column still work
        await db.update(messages)
            .set({
                metadata: reactionSummary.length > 0
                    ? sql`coalesce(${messages.metadata}, '{}'::jsonb) || ${JSON.stringify({
                        reactionSummary: toPersistedReactionSummary(reactionSummary),
                    })}::jsonb`
                    : sql`coalesce(${messages.metadata}, '{}'::jsonb) - 'reactionSummary'`,
            })
            .where(eq(messages.id, messageId));

        return { success: true, added: !existing, reactionSummary };
    } catch (error) {
        console.error('Error toggling reaction v2:', error);
        return { success: false, error: 'Failed to toggle reaction' };
    }
}
