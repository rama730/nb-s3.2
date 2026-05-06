import { emitTaskCommentMentionNotification } from "@/lib/notifications/emitters";
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

    const results = await Promise.allSettled(
        recipientUserIds.map((recipientUserId) =>
            emitTaskCommentMentionNotification({
                recipientUserId,
                actorUserId: params.authorUserId,
                actorName: params.authorDisplayName,
                actorAvatarUrl: params.authorAvatarUrl ?? null,
                projectId: params.projectId,
                projectSlug: params.projectSlug ?? null,
                taskId: params.taskId,
                commentId: params.commentId,
                parentCommentId: params.parentCommentId,
                createdAt: params.createdAt,
                previewText: trimmedPreview,
                projectLabel: params.projectLabel ?? null,
            }),
        ),
    );

    const rejectedCount = results.filter((result) => result.status === "rejected").length;
    if (rejectedCount > 0) {
        logger.warn("notifications.task_comment_mention_emit_partial_failed", {
            module: "notifications",
            projectId: params.projectId,
            taskId: params.taskId,
            commentId: params.commentId,
            count: rejectedCount,
            error: results
                .filter((result): result is PromiseRejectedResult => result.status === "rejected")
                .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
                .slice(0, 3)
                .join("; "),
        });
    }

    return { enqueued: results.filter((result) => result.status === "fulfilled").length };
}
