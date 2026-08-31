import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles, projectNodes, projects, tasks, taskNodeLinks } from "@/lib/db/schema";
import {
    enqueueProjectNotificationEvent,
    enqueueProjectNotificationEvents,
} from "@/lib/notifications/project-events";
import type { EnqueueProjectNotificationEventInput } from "@/lib/notifications/project-events";
import { logger } from "@/lib/logger";
import type { ProjectNotificationEventKey } from "@/lib/notifications/project-policy";

function taskFileEventKey(kind: "task_file_version" | "task_file_replaced" | "task_file_needs_review"): ProjectNotificationEventKey {
    if (kind === "task_file_needs_review") return "files.review_requested";
    if (kind === "task_file_replaced") return "files.replaced";
    return "files.version_added";
}

function taskFileActionLabel(kind: "task_file_version" | "task_file_replaced" | "task_file_needs_review") {
    if (kind === "task_file_needs_review") return "marked a task file for review";
    if (kind === "task_file_replaced") return "replaced a task file";
    return "uploaded a new file version";
}

function taskFileHref(projectSlugOrId: string, taskId: string, fileId: string) {
    return `/projects/${encodeURIComponent(projectSlugOrId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(taskId)}&panelTab=files&fileId=${encodeURIComponent(fileId)}`;
}

export async function notifyTaskParticipantsForFileEvent(params: {
    actorUserId: string;
    projectId: string;
    nodeId: string;
    kind: "task_file_version" | "task_file_replaced" | "task_file_needs_review";
    version?: number | null;
}) {
    try {
        const [actor, node] = await Promise.all([
            db.query.profiles.findFirst({
                where: eq(profiles.id, params.actorUserId),
                columns: { fullName: true, username: true, avatarUrl: true },
            }),
            db.query.projectNodes.findFirst({
                where: and(eq(projectNodes.id, params.nodeId), eq(projectNodes.projectId, params.projectId), isNull(projectNodes.deletedAt)),
                columns: { id: true, name: true },
            }),
        ]);
        if (!node) return;

        const linkedTasks = await db
            .select({
                taskId: tasks.id,
                taskTitle: tasks.title,
                taskNumber: tasks.taskNumber,
                assigneeId: tasks.assigneeId,
                creatorId: tasks.creatorId,
                projectId: projects.id,
                projectSlug: projects.slug,
                projectKey: projects.key,
            })
            .from(taskNodeLinks)
            .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
            .innerJoin(projects, eq(tasks.projectId, projects.id))
            .where(and(eq(taskNodeLinks.nodeId, params.nodeId), eq(tasks.projectId, params.projectId), isNull(tasks.deletedAt)));

        const actorName = actor?.fullName || actor?.username || null;
        const actionLabel = taskFileActionLabel(params.kind);
        const events: EnqueueProjectNotificationEventInput[] = linkedTasks.flatMap((task) => {
            const recipients = Array.from(new Set([task.assigneeId, task.creatorId].filter(Boolean) as string[]))
                .filter((recipientUserId) => recipientUserId !== params.actorUserId);
            if (recipients.length === 0) return [];
            return [{
                projectId: task.projectId,
                actorUserId: params.actorUserId,
                actorName,
                actorAvatarUrl: actor?.avatarUrl ?? null,
                eventKey: taskFileEventKey(params.kind),
                taskParticipantIds: recipients,
                reviewerIds: params.kind === "task_file_needs_review" ? recipients : null,
                title: `${actorName || "Someone"} ${actionLabel}`,
                body: node.name,
                href: taskFileHref(task.projectSlug || task.projectId, task.taskId, node.id),
                entityRefs: {
                    projectId: task.projectId,
                    projectSlug: task.projectSlug ?? null,
                    taskId: task.taskId,
                    fileId: node.id,
                },
                preview: {
                    actorName,
                    actorAvatarUrl: actor?.avatarUrl ?? null,
                    contextLabel: task.projectKey && task.taskNumber ? `${task.projectKey}-${task.taskNumber}` : "Task file",
                    contextKind: "file",
                    secondaryText: params.version ? `${node.name} v${params.version}` : node.name,
                },
                sourceEventId: `${task.taskId}:${params.kind}:${node.id}:${params.version ?? "latest"}`,
            }];
        });
        await enqueueProjectNotificationEvents(events, {
            actorName,
            actorAvatarUrl: actor?.avatarUrl ?? null,
        });
    } catch (error) {
        logger.warn("notifications.task_file_emit_failed", {
            module: "notifications",
            projectId: params.projectId,
            nodeId: params.nodeId,
            kind: params.kind,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * Notify relevant users when a new file version is created.
 *
 * Branching logic:
 * - If the node has one or more task_node_links → emit existing `task_file_replaced`
 *   notification with its existing audience logic (task participants).
 * - If the node has zero task_node_links → emit `file_version_added` to:
 *   favoriters (requires server-side favorites — currently skipped as favorites
 *   are client-side only) + last 5 distinct editors of the node + participants
 *   of any linked tasks (empty when zero links).
 */
export async function notifyForFileVersionCreated(params: {
    actorUserId: string;
    projectId: string;
    nodeId: string;
    version: number;
}) {
    try {
        // Fetch actor profile, node info, and task link count in parallel
        const [actor, node, linkedTasks] = await Promise.all([
            db.query.profiles.findFirst({
                where: eq(profiles.id, params.actorUserId),
                columns: { fullName: true, username: true, avatarUrl: true },
            }),
            db.query.projectNodes.findFirst({
                where: and(
                    eq(projectNodes.id, params.nodeId),
                    eq(projectNodes.projectId, params.projectId),
                    isNull(projectNodes.deletedAt),
                ),
                columns: { id: true, name: true, projectId: true },
            }),
            db
                .select({
                    taskId: tasks.id,
                    taskTitle: tasks.title,
                    taskNumber: tasks.taskNumber,
                    assigneeId: tasks.assigneeId,
                    creatorId: tasks.creatorId,
                    projectId: projects.id,
                    projectSlug: projects.slug,
                    projectKey: projects.key,
                })
                .from(taskNodeLinks)
                .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
                .innerJoin(projects, eq(tasks.projectId, projects.id))
                .where(and(
                    eq(taskNodeLinks.nodeId, params.nodeId),
                    eq(tasks.projectId, params.projectId),
                    isNull(tasks.deletedAt),
                )),
        ]);

        if (!node) return;

        if (linkedTasks.length > 0) {
            const actorName = actor?.fullName || actor?.username || null;
            const events: EnqueueProjectNotificationEventInput[] = linkedTasks.flatMap((task) => {
                const recipients = Array.from(
                    new Set([task.assigneeId, task.creatorId].filter(Boolean) as string[]),
                ).filter((recipientUserId) => recipientUserId !== params.actorUserId);
                if (recipients.length === 0) return [];
                return [{
                    projectId: task.projectId,
                    actorUserId: params.actorUserId,
                    actorName,
                    actorAvatarUrl: actor?.avatarUrl ?? null,
                    eventKey: "files.replaced",
                    taskParticipantIds: recipients,
                    title: `${actorName || "Someone"} replaced a task file`,
                    body: node.name,
                    href: taskFileHref(task.projectSlug || task.projectId, task.taskId, node.id),
                    entityRefs: {
                        projectId: task.projectId,
                        projectSlug: task.projectSlug ?? null,
                        taskId: task.taskId,
                        fileId: node.id,
                    },
                    preview: {
                        actorName,
                        actorAvatarUrl: actor?.avatarUrl ?? null,
                        contextLabel: task.projectKey && task.taskNumber ? `${task.projectKey}-${task.taskNumber}` : "Task file",
                        contextKind: "file",
                        secondaryText: `${node.name} v${params.version}`,
                    },
                    sourceEventId: `${task.taskId}:file-replaced:${node.id}:${params.version}`,
                }];
            });
            await enqueueProjectNotificationEvents(events, {
                actorName,
                actorAvatarUrl: actor?.avatarUrl ?? null,
            });
        } else {
            // Node has zero task links → emit file_version_added notification
            // Audience: favoriters (client-side only, not available server-side)
            //         + last 5 distinct editors
            //         + linked-task participants (empty since zero links)

            // Get last 5 distinct editors from file_versions (by uploadedBy, most recent first)
            const recentEditorRows = await db.execute<{ uploaded_by: string }>(sql`
                SELECT uploaded_by
                FROM (
                    SELECT DISTINCT ON (uploaded_by) uploaded_by, uploaded_at
                    FROM file_versions
                    WHERE node_id = ${params.nodeId}
                      AND uploaded_by IS NOT NULL
                      AND uploaded_by != ${params.actorUserId}
                    ORDER BY uploaded_by, uploaded_at DESC
                ) recent_editors
                ORDER BY uploaded_at DESC, uploaded_by
                LIMIT 5
            `);

            const recipients = Array.from(recentEditorRows)
                .map((row) => row.uploaded_by)
                .filter((id): id is string => id != null);

            if (recipients.length === 0) return;

            const project = await db.query.projects.findFirst({
                where: eq(projects.id, params.projectId),
                columns: { slug: true },
            });

            const actorName = actor?.fullName || actor?.username || null;
            await enqueueProjectNotificationEvent({
                projectId: params.projectId,
                actorUserId: params.actorUserId,
                actorName,
                actorAvatarUrl: actor?.avatarUrl ?? null,
                eventKey: "files.version_added",
                directRecipientIds: recipients,
                title: `${actorName || "Someone"} added a new version`,
                body: `${node.name} v${params.version}`,
                href: `/projects/${encodeURIComponent(project?.slug || params.projectId)}?tab=files&fileId=${encodeURIComponent(node.id)}`,
                entityRefs: {
                    projectId: params.projectId,
                    projectSlug: project?.slug ?? null,
                    fileId: node.id,
                },
                preview: {
                    actorName,
                    actorAvatarUrl: actor?.avatarUrl ?? null,
                    contextLabel: "File version",
                    contextKind: "file",
                    secondaryText: `${node.name} v${params.version}`,
                },
                sourceEventId: `${node.id}:version:${params.version}`,
            });
        }
    } catch (error) {
        logger.warn("notifications.file_version_created_emit_failed", {
            module: "notifications",
            projectId: params.projectId,
            nodeId: params.nodeId,
            version: params.version,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
