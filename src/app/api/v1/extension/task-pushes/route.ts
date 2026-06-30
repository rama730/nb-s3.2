import { requireAuthenticatedUser, jsonSuccess, jsonError } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { taskPushes, profiles, tasks } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { eq, and, desc } from "drizzle-orm";
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

    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
      columns: { projectId: true, deletedAt: true },
    });
    if (!task || task.deletedAt) {
      return jsonError("Task not found", 404, "NOT_FOUND");
    }
    const access = await getProjectAccessById(task.projectId, user.id);
    if (!access.canRead) {
      return jsonError("Forbidden", 403, "FORBIDDEN");
    }

    // Fetch pushes with profile info
    const rows = await db
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
      .orderBy(desc(taskPushes.pushedAt));

    return jsonSuccess({
      pushes: rows.map((r) => ({
        id: r.id,
        message: r.message,
        filesCount: r.filesCount,
        pushedAt: r.pushedAt.toISOString(),
        files: r.filesJson,
        pushedByName: r.pushedByName || "Collaborator",
      })),
    });
  } catch (error) {
    logger.error("[api/v1/extension/task-pushes] Failed to get task pushes", {
      error: error instanceof Error ? error.message : String(error)
    });
    return jsonError(
      error instanceof Error ? error.message : "Failed to get task pushes",
      500,
      "INTERNAL_ERROR"
    );
  }
}
