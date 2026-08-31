import { enqueueProjectNotificationEvent } from "@/lib/notifications/project-events";
import { logger } from "@/lib/logger";

export interface TaskCommentMentionNotificationPayload {
    recipientUserId: string;
    authorUserId: string;
    authorDisplayName: string | null;
    authorAvatarUrl?: string | null;
    projectId: string;
    projectSlug?: string | null;
    taskId: string;
    commentId: string;
    parentCommentId: string | null;
    preview: string;
    createdAt: string;
}

export interface EnqueueTaskCommentMentionParams {
    recipientUserIds: Iterable<string>;
    authorUserId: string;
    authorDisplayName: string | null;
    authorAvatarUrl?: string | null;
    projectId: string;
    projectSlug?: string | null;
    projectLabel?: string | null;
    taskId: string;
    commentId: string;
    parentCommentId: string | null;
    preview: string;
    createdAt: Date;
}

const MAX_PREVIEW_LENGTH = 280;

function trimPreview(raw: string): string {
    const collapsed = raw.replace(/\s+/g, " ").trim();
    if (collapsed.length <= MAX_PREVIEW_LENGTH) return collapsed;
    return `${collapsed.slice(0, MAX_PREVIEW_LENGTH - 1).trimEnd()}\u2026`;
}

export async function enqueueTaskCommentMentionNotifications(
    params: EnqueueTaskCommentMentionParams,
): Promise<{ enqueued: number }> {
    const recipients = new Set<string>();
    for (const id of params.recipientUserIds) {
        if (!id || id === params.authorUserId) continue;
        recipients.add(id);
    }

    if (recipients.size === 0) {
        return { enqueued: 0 };
    }

    const trimmedPreview = trimPreview(params.preview);
    const recipientUserIds = Array.from(recipients);

    try {
        const result = await enqueueProjectNotificationEvent({
            projectId: params.projectId,
            actorUserId: params.authorUserId,
            actorName: params.authorDisplayName,
            actorAvatarUrl: params.authorAvatarUrl ?? null,
            eventKey: "tasks.mentions",
            directRecipientIds: recipientUserIds,
            title: `${params.authorDisplayName || "Someone"} mentioned you in a task comment`,
            body: trimmedPreview,
            href: `/projects/${encodeURIComponent(params.projectSlug || params.projectId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(params.taskId)}&panelTab=comments&commentId=${encodeURIComponent(params.commentId)}`,
            entityRefs: {
                projectId: params.projectId,
                projectSlug: params.projectSlug ?? null,
                taskId: params.taskId,
                commentId: params.commentId,
                parentCommentId: params.parentCommentId,
                createdAt: params.createdAt.toISOString(),
            },
            preview: {
                actorName: params.authorDisplayName,
                actorAvatarUrl: params.authorAvatarUrl ?? null,
                contextLabel: params.projectLabel ?? "Task comment",
                contextKind: "task",
            },
            sourceEventId: params.commentId,
        });
        return {
            enqueued: "delivered" in result && typeof result.delivered === "number"
                ? result.delivered
                : typeof result.enqueued === "number"
                    ? result.enqueued
                    : 0,
        };
    } catch (error) {
        logger.warn("notifications.task_comment_mention_emit_failed", {
            module: "notifications",
            projectId: params.projectId,
            taskId: params.taskId,
            commentId: params.commentId,
            count: recipientUserIds.length,
            error: error instanceof Error ? error.message : String(error),
        });
        return { enqueued: 0 };
    }
}
