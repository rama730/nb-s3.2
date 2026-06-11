"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { projectMembers, projectNodes, projectSprints, taskNodeLinks, tasks } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { enqueueProjectNotificationEvent } from "@/lib/notifications/project-events";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { queueCounterRefreshBestEffort } from "@/lib/workspace/counter-buffer";
import { getTaskFileWarnings } from "@/lib/projects/task-file-intelligence";
import { logger } from "@/lib/logger";
import { isProjectMemberEligibleFor, requireProjectCapability } from "@/lib/projects/collaborator-lifecycle";

type MutableTaskField = "title" | "description" | "priority" | "sprintId" | "dueDate";

const ALLOWED_FIELDS: ReadonlySet<MutableTaskField> = new Set([
    "title",
    "description",
    "priority",
    "sprintId",
    "dueDate",
]);

type Priority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";

function taskActorSnapshot(user: { user_metadata?: Record<string, unknown> | null }) {
    return {
        actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
        actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    };
}

function taskHref(projectSlugOrId: string, taskId: string) {
    return `/projects/${encodeURIComponent(projectSlugOrId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(taskId)}`;
}

function taskContextLabel(projectKey?: string | null, taskNumber?: number | null) {
    return projectKey && taskNumber ? `${projectKey}-${taskNumber}` : "Task";
}

/**
 * SEC-H5: Atomically lock the task's project + membership rows and verify
 * the caller still has write access. Because the locks are held until the
 * surrounding transaction commits, a concurrent "remove member" operation
 * will serialize after the write and can no longer race ahead of the
 * in-flight update.
 */
async function lockTaskForWrite(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    taskId: string,
    userId: string,
): Promise<{
    projectId: string;
    isOwner: boolean;
    previousAssigneeId: string | null;
    creatorId: string;
    title: string;
    taskNumber: number | null;
    currentStatus: TaskStatus;
    projectSlug: string | null;
    projectKey: string | null;
}> {
    const taskRows = await tx.execute<{
        id: string;
        project_id: string;
        assignee_id: string | null;
        creator_id: string;
        title: string;
        task_number: number | null;
        status: TaskStatus;
    }>(sql`
        SELECT id, project_id, assignee_id, creator_id, title, task_number, status
        FROM tasks
        WHERE id = ${taskId}
        FOR UPDATE
    `);
    const task = Array.from(taskRows)[0];
    if (!task) {
        throw new Error("Task not found");
    }

    const projectRows = await tx.execute<{
        id: string;
        owner_id: string;
        slug: string | null;
        key: string | null;
        deleted_at: Date | string | null;
    }>(sql`
        SELECT id, owner_id, slug, key, deleted_at
        FROM projects
        WHERE id = ${task.project_id}
        FOR UPDATE
    `);
    const project = Array.from(projectRows)[0];
    if (!project || project.deleted_at) {
        throw new Error("Forbidden");
    }
    const isOwner = project.owner_id === userId;
    if (!isOwner) {
        const memberRows = await tx.execute<{ role: string | null }>(sql`
            SELECT role
            FROM project_members
            WHERE project_id = ${task.project_id}
              AND user_id = ${userId}
            FOR UPDATE
        `);
        const member = Array.from(memberRows)[0];
        if (!member) {
            throw new Error("Forbidden");
        }
        if ((member.role ?? "").toLowerCase() === "viewer") {
            throw new Error("Forbidden");
        }
    }
    return {
        projectId: task.project_id,
        isOwner,
        previousAssigneeId: task.assignee_id ?? null,
        creatorId: task.creator_id,
        title: task.title,
        taskNumber: task.task_number ?? null,
        currentStatus: task.status,
        projectSlug: project.slug ?? null,
        projectKey: project.key ?? null,
    };
}

const updateTaskFieldSchema = z.object({
    taskId: z.string().uuid(),
    field: z.enum(["title", "description", "priority", "sprintId", "dueDate"]),
    value: z.union([z.string(), z.null()]).optional(),
    projectId: z.string().uuid(),
});

/**
 * Update task field
 */
export async function updateTaskFieldAction(
    taskId: string,
    field: string,
    value: unknown,
    projectId: string
) {
    try {
        const parsed = updateTaskFieldSchema.safeParse({ taskId, field, value, projectId });
        if (!parsed.success) {
            return { success: false, error: "Invalid input: " + parsed.error.issues.map(i => i.message).join(", ") };
        }

        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }
        const { allowed: taskRlOk } = await consumeRateLimit(`task:${user.id}`, 60, 60);
        if (!taskRlOk) return { success: false, error: "Rate limit exceeded" };

        if (!ALLOWED_FIELDS.has(parsed.data.field)) {
            return { success: false, error: "Invalid field" };
        }

        const result = await db.transaction(async (tx) => {
            const locked = await lockTaskForWrite(tx, taskId, user.id);
            if (locked.projectId !== projectId) {
                throw new Error("Task does not belong to this project");
            }

            const updates: Partial<typeof tasks.$inferInsert> = {
                updatedAt: new Date(),
            };

            if (field === "title") {
                const title = typeof value === "string" ? value.trim() : "";
                if (!title) throw new Error("Title is required");
                updates.title = title;
            } else if (field === "description") {
                updates.description = typeof value === "string" && value.trim() ? value : null;
            } else if (field === "priority") {
                const priority = typeof value === "string" ? value : "";
                if (!["low", "medium", "high", "urgent"].includes(priority)) {
                    throw new Error("Invalid priority");
                }
                updates.priority = priority as Priority;
            } else if (field === "sprintId") {
                if (!locked.isOwner) {
                    throw new Error("Only the project owner can change sprint assignments");
                }
                const sprintId = typeof value === "string" && value ? value : null;
                if (sprintId) {
                    const sprint = await tx.query.projectSprints.findFirst({
                        where: and(eq(projectSprints.id, sprintId), eq(projectSprints.projectId, locked.projectId)),
                        columns: { id: true },
                    });
                    if (!sprint) {
                        throw new Error("Sprint must belong to this project");
                    }
                }
                updates.sprintId = sprintId;
            } else if (field === "dueDate") {
                if (typeof value === "string" && value) {
                    const parsed = new Date(value);
                    if (Number.isNaN(parsed.getTime())) {
                        throw new Error("Invalid due date");
                    }
                    updates.dueDate = parsed;
                } else {
                    updates.dueDate = null;
                }
            }

            await tx.update(tasks).set(updates).where(eq(tasks.id, taskId));
            return { previousAssigneeId: locked.previousAssigneeId, projectId: locked.projectId };
        });

        await queueCounterRefreshBestEffort([result.previousAssigneeId]);
        revalidatePath(`/projects/${result.projectId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to update task" };
    }
}

/**
 * Update task status
 */
export async function updateTaskStatusAction(
    taskId: string,
    status: TaskStatus,
    projectId: string
) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }
        const { allowed: taskRlOk } = await consumeRateLimit(`task:${user.id}`, 60, 60);
        if (!taskRlOk) return { success: false, error: "Rate limit exceeded" };

        if (!["todo", "in_progress", "done", "blocked"].includes(status)) {
            return { success: false, error: "Invalid status" };
        }

        const result = await db.transaction(async (tx) => {
            const locked = await lockTaskForWrite(tx, taskId, user.id);
            if (locked.projectId !== projectId) {
                throw new Error("Task does not belong to this project");
            }
            await tx.update(tasks).set({
                status,
                updatedAt: new Date(),
            }).where(eq(tasks.id, taskId));
            return locked;
        });

        const warnings =
            status === "done"
                ? await db
                    .select({
                        id: projectNodes.id,
                        name: projectNodes.name,
                        type: projectNodes.type,
                        path: projectNodes.path,
                        annotation: taskNodeLinks.annotation,
                    })
                    .from(taskNodeLinks)
                    .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
                    .where(
                        and(
                            eq(taskNodeLinks.taskId, taskId),
                            eq(projectNodes.projectId, projectId),
                            isNull(projectNodes.deletedAt),
                        ),
                    )
                    .then((rows) => getTaskFileWarnings({
                        status,
                        attachments: rows,
                    }))
                : [];

        await queueCounterRefreshBestEffort([result.previousAssigneeId]);
        if ((status === "blocked" || status === "done") && status !== result.currentStatus) {
            const recipients = new Set<string>();
            if (result.creatorId !== user.id) {
                recipients.add(result.creatorId);
            }
            if (result.previousAssigneeId && result.previousAssigneeId !== user.id) {
                recipients.add(result.previousAssigneeId);
            }
            try {
                const actor = taskActorSnapshot(user);
                await enqueueProjectNotificationEvent({
                    projectId: result.projectId,
                    actorUserId: user.id,
                    ...actor,
                    eventKey: "tasks.status_attention",
                    taskParticipantIds: Array.from(recipients),
                    title: `${actor.actorName || "Someone"} marked a task ${status === "blocked" ? "blocked" : "done"}`,
                    body: result.title,
                    href: taskHref(result.projectSlug || result.projectId, taskId),
                    entityRefs: {
                        projectId: result.projectId,
                        projectSlug: result.projectSlug ?? null,
                        taskId,
                        status,
                    },
                    preview: {
                        actorName: actor.actorName,
                        actorAvatarUrl: actor.actorAvatarUrl,
                        contextLabel: taskContextLabel(result.projectKey, result.taskNumber),
                        contextKind: "task",
                        secondaryText: status,
                    },
                    sourceEventId: `${taskId}:status:${status}`,
                });
            } catch (notificationError) {
                logger.error("tasks.status_attention_notification_failed", {
                    module: "tasks",
                    projectId: result.projectId,
                    taskId,
                    actorUserId: user.id,
                    status,
                    count: recipients.size,
                    error: notificationError instanceof Error ? notificationError.message : String(notificationError),
                });
            }
        }
        revalidatePath(`/projects/${result.projectId}`);
        return { success: true, warnings };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to update task status" };
    }
}

const assignTaskSchema = z.object({
    taskId: z.string().uuid(),
    assigneeId: z.string().uuid().nullable(),
    projectId: z.string().uuid(),
});

/**
 * Assign task to user
 */
export async function assignTaskAction(
    taskId: string,
    assigneeId: string | null,
    projectId: string
) {
    try {
        const parsed = assignTaskSchema.safeParse({ taskId, assigneeId, projectId });
        if (!parsed.success) {
            return { success: false, error: "Invalid input: " + parsed.error.issues.map(i => i.message).join(", ") };
        }

        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }
        const { allowed: taskRlOk } = await consumeRateLimit(`task:${user.id}`, 60, 60);
        if (!taskRlOk) return { success: false, error: "Rate limit exceeded" };
        await requireProjectCapability(parsed.data.projectId, user.id, "assign_tasks");

        const result = await db.transaction(async (tx) => {
            const locked = await lockTaskForWrite(tx, taskId, user.id);
            if (locked.projectId !== projectId) {
                throw new Error("Task does not belong to this project");
            }

            if (assigneeId) {
                const isProjectMember = await tx.query.projectMembers.findFirst({
                    where: and(
                        eq(projectMembers.projectId, locked.projectId),
                        eq(projectMembers.userId, assigneeId),
                    ),
                    columns: { id: true, role: true },
                });
                if (!isProjectMember) {
                    throw new Error("Assignee must be a project member");
                }
                if (!isProjectMemberEligibleFor(isProjectMember.role, "assign")) {
                    throw new Error("Assignee must be an assignable project member");
                }
            }

            await tx.update(tasks).set({
                assigneeId: assigneeId || null,
                updatedAt: new Date(),
            }).where(eq(tasks.id, taskId));

            return locked;
        });

        await queueCounterRefreshBestEffort([result.previousAssigneeId, assigneeId]);
        if (assigneeId && assigneeId !== user.id && assigneeId !== result.previousAssigneeId) {
            try {
                const actor = taskActorSnapshot(user);
                await enqueueProjectNotificationEvent({
                    projectId: result.projectId,
                    actorUserId: user.id,
                    ...actor,
                    eventKey: "tasks.assigned",
                    assigneeId,
                    title: `${actor.actorName || "Someone"} assigned you a task`,
                    body: result.title,
                    href: taskHref(result.projectSlug || result.projectId, taskId),
                    entityRefs: {
                        projectId: result.projectId,
                        projectSlug: result.projectSlug ?? null,
                        taskId,
                    },
                    preview: {
                        actorName: actor.actorName,
                        actorAvatarUrl: actor.actorAvatarUrl,
                        contextLabel: taskContextLabel(result.projectKey, result.taskNumber),
                        contextKind: "task",
                        secondaryText: result.title,
                    },
                    sourceEventId: `${taskId}:assigned`,
                });
            } catch (notificationError) {
                logger.error("tasks.assignment_notification_failed", {
                    module: "tasks",
                    projectId: result.projectId,
                    taskId,
                    actorUserId: user.id,
                    targetUserId: assigneeId,
                    error: notificationError instanceof Error ? notificationError.message : String(notificationError),
                });
            }
        }
        revalidatePath(`/projects/${result.projectId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to assign task" };
    }
}
