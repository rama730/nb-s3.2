"use server";

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { conversationParticipants, messageWorkLinks, tasks } from "@/lib/db/schema";
import { assertProjectReadAccess } from "@/lib/files/internal-helpers";
import {
    groupLinkedWorkByMessage,
    mapMessageWorkLinkToSummary,
    type MessageLinkedWorkSummary,
} from "@/lib/messages/linked-work";
import { logger } from "@/lib/logger";
import { isLooseUuid } from "@/lib/validations/uuid";

async function getViewerId() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
}

async function assertConversationAccess(conversationId: string, userId: string) {
    const [participant] = await db
        .select({ id: conversationParticipants.id })
        .from(conversationParticipants)
        .where(and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId),
        ))
        .limit(1);

    if (!participant) throw new Error("Not authorized for this conversation");
}

export async function readMessageWorkLinksAction(
    conversationId: string,
    messageIds: string[],
): Promise<{
    success: boolean;
    error?: string;
    linksByMessageId: Record<string, MessageLinkedWorkSummary[]>;
}> {
    try {
        const userId = await getViewerId();
        if (!userId) return { success: false, error: "Unauthorized", linksByMessageId: {} };
        const uniqueMessageIds = Array.from(
            new Set(messageIds.filter(id => id && isLooseUuid(id)))
        ).slice(0, 120);

        if (uniqueMessageIds.length === 0) {
            return { success: true, linksByMessageId: {} };
        }

        const [participants, rows] = await Promise.all([
            db
                .select({ id: conversationParticipants.id })
                .from(conversationParticipants)
                .where(and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, userId),
                ))
                .limit(1),
            db
                .select()
                .from(messageWorkLinks)
                .where(and(
                    eq(messageWorkLinks.sourceConversationId, conversationId),
                    inArray(messageWorkLinks.sourceMessageId, uniqueMessageIds),
                    isNull(messageWorkLinks.deletedAt),
                    or(
                        eq(messageWorkLinks.visibility, "shared"),
                        eq(messageWorkLinks.ownerUserId, userId),
                        eq(messageWorkLinks.createdBy, userId),
                    ),
                ))
                .orderBy(messageWorkLinks.updatedAt),
        ]);

        if (participants.length === 0) {
            return { success: false, error: "Not authorized for this conversation", linksByMessageId: {} };
        }

        return {
            success: true,
            linksByMessageId: groupLinkedWorkByMessage(rows.map(mapMessageWorkLinkToSummary)),
        };
    } catch (error) {
        logger.error("messages.linked_work_read_failed", {
            module: "messaging",
            conversationId,
            count: messageIds.length,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Failed to load linked work", linksByMessageId: {} };
    }
}

export async function readTaskSourceMessageLinksAction(projectId: string, taskId: string) {
    try {
        const userId = await getViewerId();
        if (!userId) return { success: false as const, error: "Unauthorized", links: [] };
        await assertProjectReadAccess(projectId, userId);

        const rows = await db
            .select({ link: messageWorkLinks })
            .from(messageWorkLinks)
            .innerJoin(
                tasks,
                and(
                    eq(tasks.id, messageWorkLinks.targetId),
                    eq(tasks.projectId, projectId),
                ),
            )
            .where(and(
                eq(messageWorkLinks.targetType, "task"),
                eq(messageWorkLinks.targetId, taskId),
                eq(messageWorkLinks.targetProjectId, projectId),
                isNull(messageWorkLinks.deletedAt),
                or(
                    eq(messageWorkLinks.visibility, "shared"),
                    eq(messageWorkLinks.ownerUserId, userId),
                    eq(messageWorkLinks.createdBy, userId),
                ),
            ))
            .orderBy(messageWorkLinks.createdAt)
            .limit(5);

        return {
            success: true as const,
            links: rows.map((row) => mapMessageWorkLinkToSummary(row.link)),
        };
    } catch (error) {
        logger.error("messages.task_source_links_read_failed", {
            module: "messaging",
            projectId,
            taskId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to load source message", links: [] };
    }
}
