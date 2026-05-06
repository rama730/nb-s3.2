import type { NotificationPreview } from "@/lib/notifications/types";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { importanceForKind } from "@/lib/notifications/classifier";
import { emitNotificationWrite, emitNotificationWrites } from "@/lib/notifications/fanout";

type EmitExecutor = Parameters<typeof createNotification>[1];

function writeCreate(
    input: Parameters<typeof createNotification>[0],
    executor?: EmitExecutor,
) {
    return emitNotificationWrite({ operation: "create", input }, executor);
}

function buildPreview(params: {
    actorName?: string | null;
    actorAvatarUrl?: string | null;
    contextLabel?: string | null;
    contextKind?: NotificationPreview["contextKind"];
    secondaryText?: string | null;
    thumbnailUrl?: string | null;
}): NotificationPreview | null {
    const preview: NotificationPreview = {
        actorName: params.actorName ?? null,
        actorAvatarUrl: params.actorAvatarUrl ?? null,
        contextLabel: params.contextLabel ?? null,
        contextKind: params.contextKind ?? null,
        secondaryText: params.secondaryText ?? null,
        thumbnailUrl: params.thumbnailUrl ?? null,
    };
    if (!preview.actorName && !preview.contextLabel && !preview.secondaryText && !preview.thumbnailUrl) {
        return null;
    }
    return preview;
}

function humanWorkflowLabel(kind: string) {
    const labels: Record<string, string> = {
        project_invite: "project invite",
        feedback_request: "feedback request",
        availability_request: "availability request",
        task_approval: "task approval",
        follow_up: "follow-up",
    };
    return labels[kind] ?? kind.replace(/_/g, " ");
}

function toIsoString(value?: Date | string | null) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function emitMessageBurstNotifications(params: {
    recipients: Array<{ userId: string; muted?: boolean | null }>;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    conversationId: string;
    previewText: string | null;
    secondaryText?: string | null;
}, executor?: EmitExecutor) {
    const writes = params.recipients
        .filter((recipient) => recipient.userId && recipient.userId !== params.actorUserId && !recipient.muted)
        .map((recipient) => ({
            operation: "aggregate" as const,
            input: {
                recipientUserId: recipient.userId,
                actorUserId: params.actorUserId,
                category: "messages" as const,
                kind: "message_burst" as const,
                importance: importanceForKind("message_burst"),
                title: params.actorName ? `New message from ${params.actorName}` : "New message",
                body: params.previewText,
                href: `/messages?conversationId=${encodeURIComponent(params.conversationId)}`,
                entityRefs: {
                    conversationId: params.conversationId,
                },
                preview: buildPreview({
                    actorName: params.actorName,
                    actorAvatarUrl: params.actorAvatarUrl,
                    contextLabel: "Conversation",
                    contextKind: "conversation",
                    secondaryText: params.secondaryText ?? null,
                }),
                dedupeKey: `message-burst:${params.conversationId}`,
                aggregateCount: 1,
            },
        }));
    return emitNotificationWrites(writes, executor ?? db);
}

export async function emitWorkflowAssignedNotification(params: {
    recipientUserId: string | null | undefined;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    workflowItemId: string;
    workflowKind: string;
    conversationId: string;
    projectId?: string | null;
    projectSlug?: string | null;
    projectTitle?: string | null;
    taskId?: string | null;
}, executor?: EmitExecutor) {
    if (!params.recipientUserId) return;
    const projectLabel = params.projectTitle || "Project";
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: params.workflowKind === "project_invite" ? "projects" : "workflows",
        kind: "workflow_assigned",
        importance: importanceForKind("workflow_assigned"),
        title: params.workflowKind === "project_invite"
            ? `${params.actorName || "Someone"} invited you to ${projectLabel}`
            : `${params.actorName || "Someone"} assigned you a ${humanWorkflowLabel(params.workflowKind)}`,
        body: params.projectTitle ? `Project: ${params.projectTitle}` : null,
        href: `/messages?conversationId=${encodeURIComponent(params.conversationId)}`,
        entityRefs: {
            workflowItemId: params.workflowItemId,
            conversationId: params.conversationId,
            projectId: params.projectId ?? null,
            projectSlug: params.projectSlug ?? null,
            taskId: params.taskId ?? null,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: params.projectTitle ?? "Workflow",
            contextKind: params.projectTitle ? "project" : "workflow",
            secondaryText: humanWorkflowLabel(params.workflowKind),
        }),
        dedupeKey: `workflow:${params.workflowItemId}:assigned`,
    }, executor);
}

export async function emitWorkflowResolvedNotification(params: {
    recipientUserId: string | null | undefined;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    workflowItemId: string;
    workflowKind: string;
    resolutionLabel: string;
    conversationId: string;
    projectId?: string | null;
    projectSlug?: string | null;
    projectTitle?: string | null;
    taskId?: string | null;
}, executor?: EmitExecutor) {
    if (!params.recipientUserId) return;
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: params.workflowKind === "project_invite" ? "projects" : "workflows",
        kind: "workflow_resolved",
        importance: importanceForKind("workflow_resolved"),
        title: `${params.actorName || "Someone"} ${params.resolutionLabel.toLowerCase()} your ${humanWorkflowLabel(params.workflowKind)}`,
        body: params.projectTitle ? `Project: ${params.projectTitle}` : null,
        href: `/messages?conversationId=${encodeURIComponent(params.conversationId)}`,
        entityRefs: {
            workflowItemId: params.workflowItemId,
            conversationId: params.conversationId,
            projectId: params.projectId ?? null,
            projectSlug: params.projectSlug ?? null,
            taskId: params.taskId ?? null,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: params.projectTitle ?? "Workflow",
            contextKind: params.projectTitle ? "project" : "workflow",
            secondaryText: params.resolutionLabel,
        }),
        dedupeKey: `workflow:${params.workflowItemId}:resolved:${params.resolutionLabel.toLowerCase()}`,
    }, executor);
}

export async function emitApplicationReceivedNotification(params: {
    recipientUserId: string;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    applicationId: string;
    projectId: string;
    projectSlug?: string | null;
    projectTitle?: string | null;
    eventKey?: string | null;
}, executor?: EmitExecutor) {
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: "applications",
        kind: "application_received",
        importance: importanceForKind("application_received"),
        title: `${params.actorName || "Someone"} applied to ${params.projectTitle || "your project"}`,
        body: params.projectTitle ? `Project: ${params.projectTitle}` : "New application received",
        href: `/people?tab=applications&applicationId=${encodeURIComponent(params.applicationId)}`,
        entityRefs: {
            applicationId: params.applicationId,
            projectId: params.projectId,
            projectSlug: params.projectSlug ?? null,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: params.projectTitle ?? "Application",
            contextKind: "application",
        }),
        dedupeKey: `application:${params.applicationId}:submitted`,
    }, executor);
}

export async function emitApplicationDecisionNotification(params: {
    recipientUserId: string;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    applicationId: string;
    status: "accepted" | "rejected" | "reopened";
    conversationId?: string | null;
    projectId: string;
    projectSlug?: string | null;
    projectTitle?: string | null;
    eventKey?: string | null;
}, executor?: EmitExecutor) {
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: "applications",
        kind: "application_decision",
        importance: importanceForKind("application_decision"),
        title: `${params.actorName || "Someone"} ${params.status === "accepted" ? "accepted" : params.status === "rejected" ? "updated" : "reopened"} your application`,
        body: params.projectTitle ? `Project: ${params.projectTitle}` : null,
        href: params.conversationId
            ? `/messages?conversationId=${encodeURIComponent(params.conversationId)}`
            : `/people?tab=applications&applicationId=${encodeURIComponent(params.applicationId)}`,
        entityRefs: {
            applicationId: params.applicationId,
            conversationId: params.conversationId ?? null,
            projectId: params.projectId,
            projectSlug: params.projectSlug ?? null,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: params.projectTitle ?? "Application",
            contextKind: "application",
            secondaryText: params.status,
        }),
        dedupeKey: `application:${params.applicationId}:decision:${params.status}`,
    }, executor);
}

export async function emitConnectionRequestReceivedNotification(params: {
    recipientUserId: string;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    connectionId: string;
    eventKey?: string | null;
}, executor?: EmitExecutor) {
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: "connections",
        kind: "connection_request_received",
        importance: importanceForKind("connection_request_received"),
        title: `${params.actorName || "Someone"} sent you a connection request`,
        href: "/people?tab=requests",
        entityRefs: {
            connectionId: params.connectionId,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: "Connections",
            contextKind: "connection",
        }),
        dedupeKey: `connection:${params.connectionId}:received`,
    }, executor);
}

export async function emitConnectionAcceptedNotification(params: {
    recipientUserId: string;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    connectionId: string;
    eventKey?: string | null;
}, executor?: EmitExecutor) {
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: "connections",
        kind: "connection_request_accepted",
        importance: importanceForKind("connection_request_accepted"),
        title: `${params.actorName || "Someone"} accepted your connection request`,
        href: "/people?tab=requests",
        entityRefs: {
            connectionId: params.connectionId,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: "Connections",
            contextKind: "connection",
        }),
        dedupeKey: `connection:${params.connectionId}:accepted`,
    }, executor);
}

export async function emitTaskAssignedNotification(params: {
    recipientUserId: string | null | undefined;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    taskId: string;
    taskTitle: string;
    taskNumber?: number | null;
    projectId: string;
    projectSlug?: string | null;
    projectKey?: string | null;
    eventKey?: string | null;
}, executor?: EmitExecutor) {
    if (!params.recipientUserId) return;
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: "tasks",
        kind: "task_assigned",
        importance: importanceForKind("task_assigned"),
        title: `${params.actorName || "Someone"} assigned you a task`,
        body: params.taskTitle,
        href: `/projects/${encodeURIComponent(params.projectSlug || params.projectId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(params.taskId)}`,
        entityRefs: {
            projectId: params.projectId,
            projectSlug: params.projectSlug ?? null,
            taskId: params.taskId,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: params.projectKey && params.taskNumber ? `${params.projectKey}-${params.taskNumber}` : "Task",
            contextKind: "task",
            secondaryText: params.taskTitle,
        }),
        dedupeKey: `task:${params.taskId}:assigned:${params.recipientUserId}`,
    }, executor);
}

export async function emitTaskStatusAttentionNotification(params: {
    recipientUserId: string | null | undefined;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    taskId: string;
    taskTitle: string;
    status: "blocked" | "done";
    projectId: string;
    projectSlug?: string | null;
    projectKey?: string | null;
    taskNumber?: number | null;
    eventKey?: string | null;
}, executor?: EmitExecutor) {
    if (!params.recipientUserId) return;
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: "tasks",
        kind: "task_status_attention",
        importance: importanceForKind("task_status_attention"),
        title: `${params.actorName || "Someone"} marked a task ${params.status === "blocked" ? "blocked" : "done"}`,
        body: params.taskTitle,
        href: `/projects/${encodeURIComponent(params.projectSlug || params.projectId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(params.taskId)}`,
        entityRefs: {
            projectId: params.projectId,
            projectSlug: params.projectSlug ?? null,
            taskId: params.taskId,
            status: params.status,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: params.projectKey && params.taskNumber ? `${params.projectKey}-${params.taskNumber}` : "Task",
            contextKind: "task",
            secondaryText: params.status,
        }),
        dedupeKey: `task:${params.taskId}:status:${params.status}:${params.recipientUserId}`,
    }, executor);
}

export async function emitTaskCommentMentionNotification(params: {
    recipientUserId: string;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    projectId: string;
    projectSlug?: string | null;
    taskId: string;
    commentId: string;
    parentCommentId?: string | null;
    createdAt?: Date | string | null;
    previewText: string;
    projectLabel?: string | null;
}, executor?: EmitExecutor) {
    const commentCreatedAt = toIsoString(params.createdAt);
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: "mentions",
        kind: "task_comment_mention",
        importance: importanceForKind("task_comment_mention"),
        title: `${params.actorName || "Someone"} mentioned you in a task comment`,
        body: params.previewText,
        href: `/projects/${encodeURIComponent(params.projectSlug || params.projectId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(params.taskId)}&panelTab=comments&commentId=${encodeURIComponent(params.commentId)}`,
        entityRefs: {
            projectId: params.projectId,
            projectSlug: params.projectSlug ?? null,
            taskId: params.taskId,
            commentId: params.commentId,
            parentCommentId: params.parentCommentId ?? null,
            createdAt: commentCreatedAt,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: params.projectLabel ?? "Task comment",
            contextKind: "task",
        }),
        dedupeKey: `task-comment-mention:${params.commentId}:${params.recipientUserId}`,
    }, executor);
}

export async function emitTaskCommentReplyNotification(params: {
    recipientUserId: string;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    projectId: string;
    projectSlug?: string | null;
    taskId: string;
    commentId: string;
    parentCommentId: string;
    createdAt?: Date | string | null;
    previewText: string;
    projectLabel?: string | null;
}, executor?: EmitExecutor) {
    const commentCreatedAt = toIsoString(params.createdAt);
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: "tasks",
        kind: "task_comment_reply",
        importance: importanceForKind("task_comment_reply"),
        title: `${params.actorName || "Someone"} replied to your task comment`,
        body: params.previewText,
        href: `/projects/${encodeURIComponent(params.projectSlug || params.projectId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(params.taskId)}&panelTab=comments&commentId=${encodeURIComponent(params.commentId)}`,
        entityRefs: {
            projectId: params.projectId,
            projectSlug: params.projectSlug ?? null,
            taskId: params.taskId,
            commentId: params.commentId,
            parentCommentId: params.parentCommentId,
            createdAt: commentCreatedAt,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: params.projectLabel ?? "Task discussion",
            contextKind: "task",
        }),
        dedupeKey: `task-comment-reply:${params.commentId}:${params.recipientUserId}`,
    }, executor);
}

export async function emitTaskFileNotification(params: {
    recipients: string[];
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    kind: "task_file_version" | "task_file_replaced" | "task_file_needs_review";
    taskId: string;
    taskTitle: string;
    projectId: string;
    projectSlug?: string | null;
    projectKey?: string | null;
    taskNumber?: number | null;
    fileId: string;
    fileName: string;
    version?: number | null;
}, executor?: EmitExecutor) {
    const uniqueRecipients = Array.from(new Set(params.recipients.filter(Boolean)))
        .filter((recipientUserId) => recipientUserId !== params.actorUserId);
    if (uniqueRecipients.length === 0) return;

    const actionLabel =
        params.kind === "task_file_version"
            ? "uploaded a new file version"
            : params.kind === "task_file_replaced"
                ? "replaced a task file"
                : "marked a task file for review";
    const writes = uniqueRecipients.map((recipientUserId) => ({
        operation: "create" as const,
        input: {
            recipientUserId,
            actorUserId: params.actorUserId,
            category: "tasks" as const,
            kind: params.kind,
            importance: importanceForKind(params.kind),
            title: `${params.actorName || "Someone"} ${actionLabel}`,
            body: params.fileName,
            href: `/projects/${encodeURIComponent(params.projectSlug || params.projectId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(params.taskId)}&panelTab=files&fileId=${encodeURIComponent(params.fileId)}`,
            entityRefs: {
                projectId: params.projectId,
                projectSlug: params.projectSlug ?? null,
                taskId: params.taskId,
                fileId: params.fileId,
            },
            preview: buildPreview({
                actorName: params.actorName,
                actorAvatarUrl: params.actorAvatarUrl,
                contextLabel: params.projectKey && params.taskNumber ? `${params.projectKey}-${params.taskNumber}` : "Task file",
                contextKind: "file",
                secondaryText: params.version ? `${params.fileName} v${params.version}` : params.fileName,
            }),
            dedupeKey: `task:${params.taskId}:file:${params.kind}:${params.fileId}:${recipientUserId}:${params.version ?? "latest"}`,
        },
    }));
    await emitNotificationWrites(writes, executor);
}
