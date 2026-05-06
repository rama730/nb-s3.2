"use server";

import { randomUUID } from "crypto";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { conversationParticipants, messages, messageWorkLinks, projectNodes } from "@/lib/db/schema";
import { assertProjectReadAccess } from "@/app/actions/files/_shared";
import {
    groupLinkedWorkByMessage,
    mapMessageWorkLinkToSummary,
    type MessageLinkedWorkSummary,
    type MessageWorkLinkStatus,
} from "@/lib/messages/linked-work";
import { buildMessageSourceHref, upsertMessageWorkLink } from "@/lib/messages/linked-work-server";
import { notifyTaskParticipantsForFileEvent } from "@/lib/notifications/task-file";
import { logger } from "@/lib/logger";

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
        await assertConversationAccess(conversationId, userId);

        const uniqueMessageIds = Array.from(new Set(messageIds.filter(Boolean))).slice(0, 120);
        if (uniqueMessageIds.length === 0) {
            return { success: true, linksByMessageId: {} };
        }

        const rows = await db
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
            .orderBy(messageWorkLinks.updatedAt);

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

export async function updateMessageWorkLinkStatusAction(
    linkId: string,
    status: MessageWorkLinkStatus,
) {
    try {
        const userId = await getViewerId();
        if (!userId) return { success: false as const, error: "Unauthorized", link: null };

        const [existing] = await db
            .select()
            .from(messageWorkLinks)
            .where(and(
                eq(messageWorkLinks.id, linkId),
                isNull(messageWorkLinks.deletedAt),
                or(
                    eq(messageWorkLinks.createdBy, userId),
                    eq(messageWorkLinks.ownerUserId, userId),
                    eq(messageWorkLinks.assigneeUserId, userId),
                ),
            ))
            .limit(1);
        if (!existing) return { success: false as const, error: "Linked work not found", link: null };

        const [updated] = await db
            .update(messageWorkLinks)
            .set({ status, updatedAt: new Date() })
            .where(and(
                eq(messageWorkLinks.id, linkId),
                isNull(messageWorkLinks.deletedAt),
                or(
                    eq(messageWorkLinks.createdBy, userId),
                    eq(messageWorkLinks.ownerUserId, userId),
                    eq(messageWorkLinks.assigneeUserId, userId),
                ),
            ))
            .returning();

        if (!updated) return { success: false as const, error: "Linked work not found or access denied", link: null };

        return {
            success: true as const,
            link: mapMessageWorkLinkToSummary(updated),
        };
    } catch (error) {
        logger.error("messages.linked_work_update_failed", {
            module: "messaging",
            linkId,
            status,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to update linked work", link: null };
    }
}

export async function dismissMessageWorkLinkAction(linkId: string) {
    return updateMessageWorkLinkStatusAction(linkId, "dismissed");
}

export async function readTaskSourceMessageLinksAction(projectId: string, taskId: string) {
    try {
        const userId = await getViewerId();
        if (!userId) return { success: false as const, error: "Unauthorized", links: [] };
        await assertProjectReadAccess(projectId, userId);

        const rows = await db
            .select()
            .from(messageWorkLinks)
            .where(and(
                eq(messageWorkLinks.targetType, "task"),
                eq(messageWorkLinks.targetId, taskId),
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
            links: rows.map(mapMessageWorkLinkToSummary),
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

async function readSourceMessage(messageId: string, userId: string) {
    const [message] = await db
        .select({
            id: messages.id,
            conversationId: messages.conversationId,
            content: messages.content,
            metadata: messages.metadata,
        })
        .from(messages)
        .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)))
        .limit(1);
    if (!message) throw new Error("Message not found");
    await assertConversationAccess(message.conversationId, userId);
    return message;
}

export async function createMessageDecisionLinkAction(params: {
    messageId: string;
    title: string;
    decisionText?: string | null;
    projectId?: string | null;
}) {
    try {
        const userId = await getViewerId();
        if (!userId) return { success: false as const, error: "Unauthorized", link: null };
        const source = await readSourceMessage(params.messageId, userId);
        if (params.projectId) await assertProjectReadAccess(params.projectId, userId);

        const link = await upsertMessageWorkLink(db, {
            sourceMessageId: source.id,
            sourceConversationId: source.conversationId,
            targetType: "decision",
            targetId: randomUUID(),
            targetProjectId: params.projectId ?? null,
            visibility: "shared",
            status: "done",
            ownerUserId: userId,
            assigneeUserId: null,
            createdBy: userId,
            href: buildMessageSourceHref(source.conversationId, source.id),
            metadata: {
                label: params.title.trim() || "Decision",
                title: params.title.trim() || "Decision",
                subtitle: params.decisionText?.trim() || source.content || null,
                decisionText: params.decisionText?.trim() || null,
                sourcePreview: source.content || null,
            },
        });

        return { success: true as const, link: mapMessageWorkLinkToSummary(link) };
    } catch (error) {
        logger.error("messages.decision_link_create_failed", {
            module: "messaging",
            messageId: params.messageId,
            projectId: params.projectId ?? null,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to create decision", link: null };
    }
}

export async function createMessageFileReviewLinkAction(params: {
    messageId: string;
    projectId: string;
    nodeId: string;
    taskId?: string | null;
    reviewerUserId?: string | null;
    note?: string | null;
}) {
    try {
        const userId = await getViewerId();
        if (!userId) return { success: false as const, error: "Unauthorized", link: null };
        const source = await readSourceMessage(params.messageId, userId);
        await assertProjectReadAccess(params.projectId, userId);

        const [node] = await db
            .select({ id: projectNodes.id, name: projectNodes.name })
            .from(projectNodes)
            .where(and(
                eq(projectNodes.id, params.nodeId),
                eq(projectNodes.projectId, params.projectId),
                isNull(projectNodes.deletedAt),
            ))
            .limit(1);
        if (!node) return { success: false as const, error: "File not found", link: null };

        const sourceHref = buildMessageSourceHref(source.conversationId, source.id);
        const link = await upsertMessageWorkLink(db, {
            sourceMessageId: source.id,
            sourceConversationId: source.conversationId,
            targetType: "file_review",
            targetId: randomUUID(),
            targetProjectId: params.projectId,
            visibility: "shared",
            status: "pending",
            ownerUserId: userId,
            assigneeUserId: params.reviewerUserId ?? null,
            createdBy: userId,
            href: params.taskId
                ? `/projects/${encodeURIComponent(params.projectId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(params.taskId)}&panelTab=files&fileId=${encodeURIComponent(params.nodeId)}`
                : sourceHref,
            metadata: {
                label: "File review",
                subtitle: params.note?.trim() || node.name,
                fileId: node.id,
                fileName: node.name,
                taskId: params.taskId ?? null,
                reviewerUserId: params.reviewerUserId ?? null,
                note: params.note?.trim() || null,
                sourcePreview: source.content || null,
                sourceMessageHref: sourceHref,
            },
        });

        await notifyTaskParticipantsForFileEvent({
            actorUserId: userId,
            projectId: params.projectId,
            nodeId: params.nodeId,
            kind: "task_file_needs_review",
        });

        return { success: true as const, link: mapMessageWorkLinkToSummary(link) };
    } catch (error) {
        logger.error("messages.file_review_link_create_failed", {
            module: "messaging",
            messageId: params.messageId,
            projectId: params.projectId,
            nodeId: params.nodeId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to create file review", link: null };
    }
}
