import { requireAuthenticatedUser, jsonSuccess, jsonError } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { projectNodes, taskNodeLinks, tasks } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { eq, and, isNull } from "drizzle-orm";
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

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId")?.trim();

    if (!taskId) {
      return jsonError("Missing taskId", 400, "BAD_REQUEST");
    }

    // 1. Check if the task exists and get its project ID
    const task = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, taskId), isNull(tasks.deletedAt)),
      columns: { projectId: true, title: true, taskNumber: true },
    });

    if (!task) {
      return jsonError("Task not found", 404, "NOT_FOUND");
    }

    const access = await getProjectAccessById(task.projectId, user.id);
    if (!access.canRead) {
      return jsonError("Forbidden", 403, "FORBIDDEN");
    }

    // 2. Fetch linked files
    const rows = await db
      .select({
        node: projectNodes,
      })
      .from(taskNodeLinks)
      .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
      .where(
        and(
          eq(taskNodeLinks.taskId, taskId),
          eq(projectNodes.projectId, task.projectId),
          isNull(projectNodes.deletedAt)
        )
      )
      .orderBy(taskNodeLinks.order, projectNodes.name);

    return jsonSuccess({
      files: rows.map((r) => ({
        id: r.node.id,
        name: r.node.name,
        type: r.node.type,
        path: r.node.path,
        s3Key: r.node.s3Key,
        size: r.node.size,
        mimeType: r.node.mimeType,
        currentVersion: r.node.currentVersion,
        syncStatus: r.node.syncStatus,
        linkedTasks: [{ id: taskId, title: task.title, taskNumber: task.taskNumber }],
        updatedAt: r.node.updatedAt?.toISOString?.() ?? r.node.updatedAt,
      })),
    });
  } catch (error) {
    logger.error("[api/v1/extension/task-files] Failed to get task files", {
      error: error instanceof Error ? error.message : String(error)
    });
    return jsonError(
      error instanceof Error ? error.message : "Failed to get task files",
      500,
      "INTERNAL_ERROR"
    );
  }
}
