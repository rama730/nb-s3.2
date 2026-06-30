import { requireAuthenticatedUser, jsonSuccess, jsonError } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { profiles, projectNodes, taskNodeLinks, taskPushes, tasks } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { and, desc, eq, isNull } from "drizzle-orm";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) return authResult.response;
    const user = authResult.user;
    if (!user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId")?.trim();
    if (!taskId) return jsonError("Missing taskId", 400, "BAD_REQUEST");

    const task = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, taskId), isNull(tasks.deletedAt)),
      columns: {
        id: true,
        projectId: true,
        title: true,
        taskNumber: true,
      },
    });
    if (!task) return jsonError("Task not found", 404, "NOT_FOUND");

    const access = await getProjectAccessById(task.projectId, user.id);
    if (!access.canRead) return jsonError("Forbidden", 403, "FORBIDDEN");

    const [fileRows, pushRows] = await Promise.all([
      db
        .select({
          node: projectNodes,
        })
        .from(taskNodeLinks)
        .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
        .where(
          and(
            eq(taskNodeLinks.taskId, taskId),
            eq(projectNodes.projectId, task.projectId),
            isNull(projectNodes.deletedAt),
          ),
        )
        .orderBy(taskNodeLinks.order, projectNodes.name),
      db
        .select({
          id: taskPushes.id,
          message: taskPushes.message,
          filesCount: taskPushes.filesCount,
          pushedAt: taskPushes.pushedAt,
          filesJson: taskPushes.filesJson,
          pushedByName: profiles.fullName,
        })
        .from(taskPushes)
        .leftJoin(profiles, eq(taskPushes.pushedBy, profiles.id))
        .where(eq(taskPushes.taskId, taskId))
        .orderBy(desc(taskPushes.pushedAt))
        .limit(25),
    ]);

    return jsonSuccess({
      task: {
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        taskNumber: task.taskNumber,
      },
      files: fileRows.map((row) => ({
        id: row.node.id,
        nodeId: row.node.id,
        name: row.node.name,
        type: row.node.type,
        path: row.node.path,
        s3Key: row.node.s3Key,
        size: row.node.size,
        mimeType: row.node.mimeType,
        currentVersion: row.node.currentVersion,
        syncStatus: row.node.syncStatus,
        linkedTasks: [{ id: taskId, title: task.title, taskNumber: task.taskNumber }],
        updatedAt: row.node.updatedAt?.toISOString?.() ?? row.node.updatedAt,
      })),
      pushes: pushRows.map((row) => ({
        id: row.id,
        message: row.message,
        filesCount: row.filesCount,
        pushedAt: row.pushedAt.toISOString(),
        files: row.filesJson,
        pushedByName: row.pushedByName || "Collaborator",
      })),
    });
  } catch (error) {
    logger.error("[api/v1/extension/task-detail] Failed to get task detail", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(
      error instanceof Error ? error.message : "Failed to get task detail",
      500,
      "INTERNAL_ERROR",
    );
  }
}
