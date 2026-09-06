import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import {
  projects,
  projectMembers,
  tasks,
  projectNodes,
  taskNodeLinks,
} from "@/lib/db/schema";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import {
  getProjectTaskCountMap,
  getProjectTaskFileCountMap,
  taskFileCountKey,
} from "@/app/api/v1/extension/_project-counts";

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
        and(eq(projectMembers.userId, user.id), isNull(projects.deletedAt)),
      );

    const projectIds = userProjects.map((project) => project.id);
    if (projectIds.length === 0) {
      return jsonSuccess({
        user: { id: user.id, email: user.email },
        projects: [],
      });
    }

    // ponytail: fast bootstrap summary mode skips expensive window-partition task/file queries
    const url = new URL(request.url);
    const isSummaryMode =
      url.searchParams.get("mode") === "summary" ||
      request.headers.get("x-nb-workspace-mode") === "summary";

    if (isSummaryMode) {
      const projectTaskCountMap = await getProjectTaskCountMap(projectIds);
      const summaryProjects = userProjects.map((project) => ({
        ...project,
        syncSequence: project.currentSequenceNumber,
        taskCount: projectTaskCountMap.get(project.id) ?? 0,
        associatedTaskPreview: null,
        tasksTruncated: false,
        tasks: [],
        files: [],
      }));

      return jsonSuccess({
        user: {
          id: user.id,
          email: user.email,
        },
        projects: summaryProjects,
      });
    }

    const [taskRowsResult, rootNodeIdRowsResult, taskFileCountMap, projectTaskCountMap] =
      await Promise.all([
        db.execute(sql`
          SELECT * FROM (
            SELECT ${tasks.id} as id, ${tasks.projectId} as "projectId", ${tasks.title} as title, 
                   ${tasks.description} as description, ${tasks.status} as status, 
                   ${tasks.priority} as priority, ${tasks.taskNumber} as "taskNumber", 
                   ${tasks.updatedAt} as "updatedAt",
                   row_number() OVER (PARTITION BY ${tasks.projectId} ORDER BY ${tasks.updatedAt} DESC) as rn
            FROM ${tasks}
            WHERE ${tasks.projectId} IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)}) AND ${tasks.deletedAt} IS NULL
          ) t WHERE t.rn <= 50
        `),
        db.execute(sql`
          SELECT id FROM (
            SELECT ${projectNodes.id} AS id,
                   row_number() OVER (
                     PARTITION BY ${projectNodes.projectId}
                     ORDER BY ${projectNodes.type}, ${projectNodes.name}, ${projectNodes.id}
                   ) AS rn
            FROM ${projectNodes}
            WHERE ${projectNodes.projectId} IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)})
              AND ${projectNodes.parentId} IS NULL
              AND ${projectNodes.deletedAt} IS NULL
          ) ranked
          WHERE ranked.rn <= 100
        `),
        getProjectTaskFileCountMap(projectIds),
        getProjectTaskCountMap(projectIds),
      ]);

    const rootNodeIds = (rootNodeIdRowsResult as unknown as Array<{ id: string }>).map((row) => row.id);
    const rootNodeRows = rootNodeIds.length === 0
      ? []
      : await db
          .select({
            node: projectNodes,
            linkedTaskId: tasks.id,
            linkedTaskTitle: tasks.title,
            linkedTaskNumber: tasks.taskNumber,
          })
          .from(projectNodes)
          .leftJoin(taskNodeLinks, eq(projectNodes.id, taskNodeLinks.nodeId))
          .leftJoin(tasks, and(eq(taskNodeLinks.taskId, tasks.id), isNull(tasks.deletedAt)))
          .where(inArray(projectNodes.id, rootNodeIds))
          .orderBy(projectNodes.projectId, projectNodes.type, projectNodes.name, projectNodes.id);

    const taskRows = taskRowsResult as unknown as Array<{
      id: string;
      projectId: string;
      title: string;
      description: string | null;
      status: string;
      priority: string;
      taskNumber: number;
      updatedAt: string | Date;
    }>;

    const tasksByProject = new Map<string, typeof taskRows>();
    for (const task of taskRows) {
      const list = tasksByProject.get(task.projectId) ?? [];
      list.push(task);
      tasksByProject.set(task.projectId, list);
    }

    const rootNodesByProject = new Map<string, Map<string, any>>();
    for (const row of rootNodeRows) {
      const node = row.node;
      const projectMap = rootNodesByProject.get(node.projectId) ?? new Map<string, any>();
      
      let nodeObj = projectMap.get(node.id);
      if (!nodeObj) {
        nodeObj = {
          id: node.id,
          nodeId: node.id,
          name: node.name,
          type: node.type,
          path: node.path,
          s3Key: node.s3Key,
          size: node.size,
          mimeType: node.mimeType,
          currentVersion: node.currentVersion,
          syncStatus: node.syncStatus,
          linkedTasks: [],
          updatedAt: node.updatedAt?.toISOString?.() ?? node.updatedAt,
        };
        projectMap.set(node.id, nodeObj);
      }
      if (row.linkedTaskId) {
        nodeObj.linkedTasks.push({
          id: row.linkedTaskId,
          title: row.linkedTaskTitle,
          taskNumber: row.linkedTaskNumber
        });
      }
      rootNodesByProject.set(node.projectId, projectMap);
    }

    const projectsWithDetails = userProjects.map((project) => {
      const projectTasks = tasksByProject.get(project.id) ?? [];
      const projectFilesMap = rootNodesByProject.get(project.id);
      const projectFiles = projectFilesMap ? Array.from(projectFilesMap.values()) : [];
      const taskCount = projectTaskCountMap.get(project.id) ?? 0;
      const singletonTask = taskCount === 1 ? (projectTasks[0] ?? null) : null;
      return {
        ...project,
        syncSequence: project.currentSequenceNumber,
        taskCount,
        associatedTaskPreview: singletonTask
          ? {
              id: singletonTask.id,
              title: singletonTask.title,
              description: singletonTask.description,
              status: singletonTask.status,
              priority: singletonTask.priority,
              taskNumber: singletonTask.taskNumber,
              filesCount:
                taskFileCountMap.get(taskFileCountKey(project.id, singletonTask.id)) || 0,
            }
          : null,
        tasksTruncated: projectTasks.length < taskCount,
        tasks: projectTasks.map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          taskNumber: task.taskNumber,
          filesCount: taskFileCountMap.get(taskFileCountKey(project.id, task.id)) || 0,
        })),
        files: projectFiles,
      };
    });

    return jsonSuccess({
      user: {
        id: user.id,
        email: user.email,
      },
      projects: projectsWithDetails,
    });
  } catch (error) {
    logger.error(
      "[api/v1/extension/workspace] Failed to fetch workspace details",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return jsonError(
      "Failed to fetch workspace details",
      500,
      "INTERNAL_ERROR",
    );
  }
}
