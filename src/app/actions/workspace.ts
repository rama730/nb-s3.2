"use server";

import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { projects, tasks, projectMembers, roleApplications, messageWorkflowItems } from "@/lib/db/schema";
import { eq, and, isNull, sql, exists, ne, or, count } from "drizzle-orm";
import { normalizeTaskSurfaceRecord } from "@/lib/projects/task-presentation";

function normalizeWorkspaceLimit(rawLimit: unknown, fallback = 24) {
    const parsed = typeof rawLimit === "number" ? rawLimit : Number(rawLimit);
    return Number.isFinite(parsed)
        ? Math.max(1, Math.min(Math.trunc(parsed), 100))
        : fallback;
}

/** Small drawer badges deliberately use scalar counts rather than task lists. */
export async function getWorkspaceSummaryAction() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false as const, error: "Not authenticated" };

        const [taskResult, applicationResult, inviteResult] = await Promise.all([
            db.select({ value: count() }).from(tasks).where(and(
                isNull(tasks.deletedAt),
                sql`${tasks.status} <> 'done'`,
                eq(tasks.assigneeId, user.id),
                exists(db.select({ id: projects.id }).from(projects).where(and(
                    eq(projects.id, tasks.projectId),
                    isNull(projects.deletedAt),
                    or(
                        eq(projects.ownerId, user.id),
                        exists(db.select({ id: projectMembers.id }).from(projectMembers).where(and(
                            eq(projectMembers.projectId, tasks.projectId),
                            eq(projectMembers.userId, user.id),
                        ))),
                    ),
                ))),
            )),
            db.select({ value: count() }).from(roleApplications).where(and(
                eq(roleApplications.creatorId, user.id),
                eq(roleApplications.status, "pending"),
            )),
            db.select({ value: count() }).from(messageWorkflowItems).where(and(
                eq(messageWorkflowItems.assigneeUserId, user.id),
                eq(messageWorkflowItems.kind, "project_invite"),
                eq(messageWorkflowItems.status, "pending"),
            )),
        ]);

        return {
            success: true as const,
            taskCount: taskResult[0]?.value ?? 0,
            requestCount: (applicationResult[0]?.value ?? 0) + (inviteResult[0]?.value ?? 0),
        };
    } catch (error) {
        console.error("Workspace summary fetch failed:", error);
        return { success: false as const, error: "Failed to fetch workspace summary" };
    }
}

/**
 * Fetch active tasks from projects the authenticated user can access.
 *
 * The workspace is an overview, not a personal-assignment inbox: the default
 * includes the team's open work so a collaborator can still see a project's
 * workload when nothing is assigned to them personally.
 */
export async function fetchWorkspaceTasksAction(
    limit: number = 24,
    scope: "my" | "team" | "all" = "all"
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Not authenticated" };
        }

        const safeLimit = normalizeWorkspaceLimit(limit);

        const baseWhere = and(
            isNull(tasks.deletedAt),
            sql`${tasks.status} <> 'done'`
        );

        const visibleProjectCheck = exists(
            db.select({ id: projects.id })
                .from(projects)
                .where(and(
                    eq(projects.id, tasks.projectId),
                    isNull(projects.deletedAt),
                    or(
                        eq(projects.ownerId, user.id),
                        exists(
                            db.select({ id: projectMembers.id })
                                .from(projectMembers)
                                .where(and(
                                    eq(projectMembers.projectId, tasks.projectId),
                                    eq(projectMembers.userId, user.id),
                                )),
                        ),
                    ),
                )),
        );

        let scopeWhere;
        if (scope === "my") {
            scopeWhere = and(visibleProjectCheck, eq(tasks.assigneeId, user.id));
        } else {
            if (scope === "team") {
                scopeWhere = and(
                    visibleProjectCheck,
                    or(isNull(tasks.assigneeId), ne(tasks.assigneeId, user.id)),
                );
            } else {
                scopeWhere = visibleProjectCheck;
            }
        }

        const taskPage = await db.query.tasks.findMany({
            where: and(baseWhere, scopeWhere),
            orderBy: (t, { asc, desc }) => [
                sql`CASE WHEN ${t.dueDate} IS NOT NULL AND ${t.dueDate} < now() THEN 0 ELSE 1 END`,
                sql`CASE ${t.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
                asc(t.dueDate),
                desc(t.updatedAt),
                desc(t.id),
            ],
            // Fetch one extra row so the compact drawer never silently hides work.
            limit: safeLimit + 1,
            extras: {
                subtaskCount: sql<number>`(SELECT count(*)::int FROM task_subtasks WHERE task_subtasks.task_id = ${tasks.id})`.as("subtask_count"),
                completedSubtaskCount: sql<number>`(SELECT count(*)::int FROM task_subtasks WHERE task_subtasks.task_id = ${tasks.id} AND task_subtasks.completed = true)`.as("completed_subtask_count"),
                fileCount: sql<number>`(SELECT count(*)::int FROM task_node_links JOIN project_nodes ON project_nodes.id = task_node_links.node_id WHERE task_node_links.task_id = ${tasks.id} AND project_nodes.deleted_at IS NULL)`.as("file_count"),
                commentCount: sql<number>`(SELECT count(*)::int FROM task_comments WHERE task_comments.task_id = ${tasks.id} AND task_comments.deleted_at IS NULL)`.as("comment_count"),
            },
            with: {
                project: {
                    columns: { id: true, title: true, key: true, slug: true },
                },
                sprint: {
                    columns: { id: true, name: true, status: true },
                },
                assignee: {
                    columns: { id: true, fullName: true, username: true, avatarUrl: true },
                },
            }
        });

        const hasMore = taskPage.length > safeLimit;
        const normalized = taskPage.slice(0, safeLimit).map((task) => ({
            ...normalizeTaskSurfaceRecord(task),
            project: task.project,
            sprint: task.sprint,
            assignee: task.assignee,
        }));
        return { success: true as const, tasks: normalized, hasMore };
    } catch (e) {
        console.error("Workspace tasks fetch failed:", e);
        return { success: false as const, error: "Failed to fetch workspace tasks" };
    }
}
