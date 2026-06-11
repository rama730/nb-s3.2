"use server";

import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { roleApplications, projects, projectOpenRoles, profiles, tasks, projectMembers, projectSprints } from "@/lib/db/schema";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { normalizeTaskSurfaceRecord } from "@/lib/projects/task-presentation";

/**
 * Fetch all active tasks assigned to the current authenticated user across all projects.
 */
export async function fetchWorkspaceTasksAction(limit: number = 50) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Not authenticated" };
        }

        const userTasks = await db.query.tasks.findMany({
            where: (t, { eq, and, isNull }) => and(
                eq(t.assigneeId, user.id),
                isNull(t.deletedAt)
            ),
            orderBy: (t, { desc }) => [desc(t.createdAt), desc(t.id)],
            limit: limit,
            with: {
                project: {
                    columns: { id: true, title: true, key: true, slug: true },
                },
                sprint: {
                    columns: { id: true, name: true, status: true },
                },
            }
        });

        const normalized = userTasks.map((task) => normalizeTaskSurfaceRecord(task));
        return { success: true as const, tasks: normalized };
    } catch (e) {
        console.error("Workspace tasks fetch failed:", e);
        return { success: false as const, error: "Failed to fetch workspace tasks" };
    }
}

/**
 * Fetch active sprints for all projects where the user is an owner or collaborator,
 * along with task completion statistics for each sprint.
 */
export async function fetchWorkspaceSprintsAction() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Not authenticated" };
        }

        // 1. Fetch project IDs the user belongs to
        const owned = await db.select({ id: projects.id }).from(projects).where(eq(projects.ownerId, user.id));
        const member = await db.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, user.id));
        const projectIds = Array.from(new Set([...owned.map(p => p.id), ...member.map(p => p.id)]));

        if (projectIds.length === 0) {
            return { success: true as const, sprints: [] };
        }

        // 2. Fetch active sprints for these projects
        const activeSprints = await db.query.projectSprints.findMany({
            where: (s, { eq, and, inArray }) => and(
                inArray(s.projectId, projectIds),
                eq(s.status, 'active')
            ),
            orderBy: (s, { desc }) => [desc(s.createdAt)],
            with: {
                project: {
                    columns: { id: true, title: true, key: true, slug: true },
                }
            }
        });

        if (activeSprints.length === 0) {
            return { success: true as const, sprints: [] };
        }

        // 3. Compute completion stats for each active sprint
        const sprintIds = activeSprints.map(s => s.id);
        const statsMap: Record<string, { total: number; completed: number }> = {};
        
        const stats = await db
            .select({
                sprintId: tasks.sprintId,
                total: sql<number>`count(*)::int`,
                completed: sql<number>`count(case when status = 'done' then 1 end)::int`
            })
            .from(tasks)
            .where(and(
                inArray(tasks.sprintId, sprintIds),
                isNull(tasks.deletedAt)
            ))
            .groupBy(tasks.sprintId);

        stats.forEach(row => {
            if (row.sprintId) {
                statsMap[row.sprintId] = { total: row.total, completed: row.completed };
            }
        });

        const sprintsWithStats = activeSprints.map(sprint => ({
            id: sprint.id,
            name: sprint.name,
            goal: sprint.goal,
            description: sprint.description,
            startDate: sprint.startDate,
            endDate: sprint.endDate,
            status: sprint.status,
            project: sprint.project,
            stats: statsMap[sprint.id] ?? { total: 0, completed: 0 }
        }));

        return { success: true as const, sprints: sprintsWithStats };
    } catch (e) {
        console.error("Workspace sprints fetch failed:", e);
        return { success: false as const, error: "Failed to fetch workspace sprints" };
    }
}

/**
 * Fetch all pending join requests on projects owned/created by the current user.
 */
export async function fetchWorkspaceJoinRequestsAction() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Not authenticated" };
        }

        const pendingApps = await db.query.roleApplications.findMany({
            where: (ra, { eq, and }) => and(
                eq(ra.creatorId, user.id),
                eq(ra.status, 'pending')
            ),
            orderBy: (ra, { desc }) => [desc(ra.createdAt)],
            with: {
                project: {
                    columns: { id: true, title: true, key: true, slug: true },
                },
                role: {
                    columns: { id: true, role: true },
                },
                applicant: {
                    columns: { id: true, username: true, fullName: true, avatarUrl: true },
                }
            }
        });

        const serialized = pendingApps.map((app) => ({
            id: app.id,
            projectId: app.projectId,
            roleId: app.roleId,
            applicantId: app.applicantId,
            message: app.message,
            status: app.status,
            createdAt: app.createdAt.toISOString(),
            project: app.project,
            role: app.role,
            applicant: app.applicant
        }));

        return { success: true as const, applications: serialized };
    } catch (e) {
        console.error("Workspace join requests fetch failed:", e);
        return { success: false as const, error: "Failed to fetch workspace join requests" };
    }
}

/**
 * Fetch a single task by ID along with its project details for deep-linking.
 */
export async function getWorkspaceTaskInfoAction(taskId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Not authenticated" };
        }

        const task = await db.query.tasks.findFirst({
            where: (t, { eq, and, isNull }) => and(
                eq(t.id, taskId),
                isNull(t.deletedAt)
            ),
            with: {
                project: {
                    columns: { id: true, title: true, key: true, slug: true },
                },
                sprint: {
                    columns: { id: true, name: true, status: true },
                },
                assignee: {
                    columns: { id: true, fullName: true, avatarUrl: true },
                },
                creator: {
                    columns: { id: true, fullName: true, avatarUrl: true },
                },
            }
        });

        if (!task) {
            return { success: false as const, error: "Task not found" };
        }

        const normalized = normalizeTaskSurfaceRecord(task);
        return { success: true as const, task: normalized };
    } catch (e) {
        console.error("Workspace task info fetch failed:", e);
        return { success: false as const, error: "Failed to fetch task info" };
    }
}
