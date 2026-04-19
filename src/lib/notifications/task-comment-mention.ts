// ============================================================================
// Task Panel Overhaul - Wave 4: task_comment_mention notification enqueue
//
// When a comment mentions one or more teammates, we:
//   1. Write one row per mentioned user into `comment_mentions` (handled by
//      the caller, inside createTaskCommentAction).
//   2. Hand off a `task_comment_mention` notification payload to the queue
//      for fan-out into whatever channels the user has enabled (in-app feed,
//      email, push, etc).
//
// Step 2 is done here. At the moment there is no central notification queue
// in the codebase, so this helper serves as the single integration point:
// once a queue lands, wiring it up only requires changing this file.
//
// Today the helper:
//   - Validates + normalizes the payload so bad data surfaces early.
//   - Skips self-mentions (the author mentioning themselves should not
//     trigger a notification).
//   - Logs a structured line via the shared logger so the event is still
//     observable in production without silently disappearing.
//
// Every caller should treat this function as fire-and-forget with a safety
// catch: it intentionally never throws, because a failure to enqueue a
// notification must not roll back the comment write.
// ============================================================================

import { logger } from "@/lib/logger";

export interface TaskCommentMentionNotificationPayload {
    /** User being notified. */
    recipientUserId: string;
    /** User who wrote the comment. */
    authorUserId: string;
    authorDisplayName: string | null;
    projectId: string;
    taskId: string;
    commentId: string;
    parentCommentId: string | null;
    /** Short plain-text preview of the comment (mention tokens already resolved). */
    preview: string;
    createdAt: string;
}

export interface EnqueueTaskCommentMentionParams {
    recipientUserIds: Iterable<string>;
    authorUserId: string;
    authorDisplayName: string | null;
    projectId: string;
    taskId: string;
    commentId: string;
    parentCommentId: string | null;
    /** Raw comment content with mention tokens resolved to plain text. */
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
    const {
        recipientUserIds,
        authorUserId,
        authorDisplayName,
        projectId,
        taskId,
        commentId,
        parentCommentId,
        preview,
        createdAt,
    } = params;

    const recipients = new Set<string>();
    for (const id of recipientUserIds) {
        if (!id || id === authorUserId) continue;
        recipients.add(id);
    }

    if (recipients.size === 0) {
        return { enqueued: 0 };
    }

    const createdAtIso = createdAt.toISOString();
    const trimmedPreview = trimPreview(preview);

    const payloads: TaskCommentMentionNotificationPayload[] = [];
    for (const recipientUserId of recipients) {
        payloads.push({
            recipientUserId,
            authorUserId,
            authorDisplayName,
            projectId,
            taskId,
            commentId,
            parentCommentId,
            preview: trimmedPreview,
            createdAt: createdAtIso,
        });
    }

    // Wrap the shipping side effect in its own try/catch so a logger failure
    // (unlikely, but possible during start-up) never escapes to the caller.
    //
    // Note: the shared logger filters context keys against an allow-list. We
    // use `viewerUserId` for the author and `subjectUserId` for the recipient
    // so the information survives sanitization; the full payload is returned
    // to the caller (and will be consumed by the real queue when it lands).
    try {
        for (const payload of payloads) {
            logger.info("notifications.task_comment_mention.enqueued", {
                module: "notifications",
                action: "task_comment_mention.enqueue",
                projectId: payload.projectId,
                taskId: payload.taskId,
                subjectUserId: payload.recipientUserId,
                viewerUserId: payload.authorUserId,
                _type: "task_comment_mention",
            });
        }
    } catch (error) {
        // Intentionally swallowed - notifications are best-effort by design.
        // A logger outage must never roll back a user's comment.
        console.error(
            "[notifications] Failed to enqueue task_comment_mention payloads",
            error,
        );
    }

    return { enqueued: payloads.length };
}
