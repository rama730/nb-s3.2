import { requireAuthenticatedUser, jsonSuccess, jsonError } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { projects, projectMembers, tasks, projectNodes, taskNodeLinks } from "@/lib/db/schema";
import { desc, eq, and, inArray, isNull, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) {
      return authResult.response;
    }
    const user = authResult.user;
    if (!user) {
      return jsonError("Not authenticated", 401, "UNAUTHORIZED");
    }

    // 1. Fetch user's projects (via project memberships)
    const userProjects = await db
      .select({
        id: projects.id,
        name: projects.title,
        slug: projects.slug,
        description: projects.description,
        currentSequenceNumber: projects.currentSequenceNumber,
      })
      .from(projects)
      .innerJoin(projectMembers, eq(projects.id, projectMembers.projectId))
      .where(
        and(
          eq(projectMembers.userId, user.id),
          isNull(projects.deletedAt)
        )
      );

    const projectIds = userProjects.map((project) => project.id);
    if (projectIds.length === 0) {
      return jsonSuccess({
        user: { email: user.email },
        projects: [],
      });
    }

    const [taskRows, rootNodeRows, taskCountRows] = await Promise.all([
      db
        .select({
          id: tasks.id,
          projectId: tasks.projectId,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          taskNumber: tasks.taskNumber,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .where(and(inArray(tasks.projectId, projectIds), isNull(tasks.deletedAt)))
        .orderBy(desc(tasks.updatedAt))
        .limit(Math.max(50, projectIds.length * 50)),
      db
        .select()
        .from(projectNodes)
        .where(
          and(
            inArray(projectNodes.projectId, projectIds),
            isNull(projectNodes.parentId),
            isNull(projectNodes.deletedAt),
          ),
        )
        .orderBy(projectNodes.projectId, projectNodes.type, projectNodes.name)
        .limit(Math.max(100, projectIds.length * 100)),
      db
        .select({
          projectId: projectNodes.projectId,
          taskId: taskNodeLinks.taskId,
          count: sql<number>`count(*)`,
        })
        .from(taskNodeLinks)
        .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
        .where(and(inArray(projectNodes.projectId, projectIds), isNull(projectNodes.deletedAt)))
        .groupBy(projectNodes.projectId, taskNodeLinks.taskId),
    ]);

    const tasksByProject = new Map<string, typeof taskRows>();
    for (const task of taskRows) {
      const list = tasksByProject.get(task.projectId) ?? [];
      if (list.length < 50) {
        list.push(task);
        tasksByProject.set(task.projectId, list);
      }
    }

    const rootNodesByProject = new Map<string, typeof rootNodeRows>();
    for (const node of rootNodeRows) {
      const list = rootNodesByProject.get(node.projectId) ?? [];
      if (list.length < 100) {
        list.push(node);
        rootNodesByProject.set(node.projectId, list);
      }
    }

    const countMap = new Map<string, number>();
    for (const row of taskCountRows) {
      countMap.set(`${row.projectId}:${row.taskId}`, Number(row.count) || 0);
    }

    const rootFileIds = rootNodeRows.map((node) => node.id);
    const linkedTaskRows = rootFileIds.length
      ? await db
          .select({
            nodeId: taskNodeLinks.nodeId,
            taskId: taskNodeLinks.taskId,
            title: tasks.title,
            taskNumber: tasks.taskNumber,
          })
          .from(taskNodeLinks)
          .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
          .where(and(inArray(taskNodeLinks.nodeId, rootFileIds), isNull(tasks.deletedAt)))
      : [];

    const linkedTaskMap = new Map<string, Array<{ id: string; title: string | null; taskNumber: number | null }>>();
    for (const row of linkedTaskRows) {
      const existing = linkedTaskMap.get(row.nodeId) ?? [];
      existing.push({ id: row.taskId, title: row.title, taskNumber: row.taskNumber });
      linkedTaskMap.set(row.nodeId, existing);
    }

    const projectsWithDetails = userProjects.map((project) => {
      const projectTasks = tasksByProject.get(project.id) ?? [];
      const projectFiles = rootNodesByProject.get(project.id) ?? [];
      return {
        ...project,
        syncSequence: project.currentSequenceNumber,
        tasks: projectTasks.map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          taskNumber: task.taskNumber,
          filesCount: countMap.get(`${project.id}:${task.id}`) || 0,
        })),
        files: projectFiles.map((file) => ({
          id: file.id,
          nodeId: file.id,
          name: file.name,
          type: file.type,
          path: file.path,
          s3Key: file.s3Key,
          size: file.size,
          mimeType: file.mimeType,
          currentVersion: file.currentVersion,
          syncStatus: file.syncStatus,
          linkedTasks: linkedTaskMap.get(file.id) ?? [],
          updatedAt: file.updatedAt?.toISOString?.() ?? file.updatedAt,
        })),
      };
    });

    return jsonSuccess({
      user: {
        email: user.email,
      },
      projects: projectsWithDetails,
    });
  } catch (error) {
    logger.error("[api/v1/extension/workspace] Failed to fetch workspace details", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError("Failed to fetch workspace details", 500, "INTERNAL_ERROR");
  }
}
