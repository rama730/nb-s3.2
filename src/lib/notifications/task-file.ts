import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles, projectNodes, projects, tasks, taskNodeLinks } from "@/lib/db/schema";
import { emitTaskFileNotification } from "@/lib/notifications/emitters";
import { logger } from "@/lib/logger";

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

        await Promise.all(linkedTasks.map((task) => {
            const recipients = Array.from(new Set([task.assigneeId, task.creatorId].filter(Boolean) as string[]))
                .filter((recipientUserId) => recipientUserId !== params.actorUserId);
            if (recipients.length === 0) return Promise.resolve();
            return emitTaskFileNotification({
                recipients,
                actorUserId: params.actorUserId,
                actorName: actor?.fullName || actor?.username || null,
                actorAvatarUrl: actor?.avatarUrl ?? null,
                kind: params.kind,
                taskId: task.taskId,
                taskTitle: task.taskTitle,
                projectId: task.projectId,
                projectSlug: task.projectSlug ?? null,
                projectKey: task.projectKey ?? null,
                taskNumber: task.taskNumber ?? null,
                fileId: node.id,
                fileName: node.name,
                version: params.version ?? null,
            });
        }));
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
