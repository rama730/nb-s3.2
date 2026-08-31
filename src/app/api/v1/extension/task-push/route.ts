import { requireAuthenticatedUser, jsonSuccess, jsonError } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { taskPushes, tasks, projectNodes } from "@/lib/db/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { getProjectAccessById } from "@/lib/data/project-access";
import { logger } from "@/lib/logger";
import { checkIdempotencyKey, saveIdempotencyResult } from "@/lib/security/idempotency";
import { recordNodeEvent } from "@/lib/files/internal-helpers";
import { validateCsrf } from "@/lib/security/csrf";

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) {
      return authResult.response;
    }
    const user = authResult.user;
    if (!user) {
      return jsonError("Not authenticated", 401, "UNAUTHORIZED");
    }

    const body = await request.json();
    const { taskId, projectId, files, message } = body;
    const taskAction = body.taskAction === "upload_to_task" ? "upload_to_task" : "replace_task_version";

    if (!taskId || !projectId || !Array.isArray(files)) {
      return jsonError("Missing taskId, projectId, or files", 400, "BAD_REQUEST");
    }

    // 1. Validate that the task exists
    const task = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, taskId), isNull(tasks.deletedAt)),
    });

    if (!task) {
      return jsonError("Task not found", 404, "NOT_FOUND");
    }
    if (task.projectId !== projectId) {
      return jsonError("Task does not belong to this project", 400, "BAD_REQUEST");
    }
    const access = await getProjectAccessById(projectId, user.id);
    if (!access.canWrite) {
      return jsonError("Forbidden", 403, "FORBIDDEN");
    }

    const idempotencyScope = `${user.id}:${projectId}:${taskId}`;
    const idempotencyCheck = await checkIdempotencyKey(request, "extension.task-push.post", idempotencyScope);
    if (idempotencyCheck.isDuplicate) {
      if (idempotencyCheck.cachedResponse) {
        return new Response(idempotencyCheck.cachedResponse, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return jsonError("Request is already being processed", 409, "CONFLICT");
    }

    const pushedFiles = files.map((file: any) => ({
      nodeId: typeof file?.nodeId === "string" ? file.nodeId : "",
      id: typeof file?.id === "string" ? file.id : "",
      name: typeof file?.name === "string" ? file.name : null,
      path: typeof file?.path === "string" ? file.path : null,
      status: typeof file?.status === "string" ? file.status : null,
      taskAction,
    }));

    const pushRow = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(taskPushes)
        .values({
          taskId,
          projectId,
          message: message || (taskAction === "upload_to_task" ? "Uploaded task files" : "Replaced task file versions"),
          filesCount: pushedFiles.length,
          pushedBy: user.id,
          filesJson: pushedFiles,
        })
        .returning();

      if (!created) {
        throw new Error("Failed to record push entry");
      }

      const nodeIds = Array.from(new Set(pushedFiles.map((file) => file.nodeId).filter(Boolean)));
      if (nodeIds.length > 0) {
        await tx
          .update(projectNodes)
          .set({
            syncStatus: "merged",
            updatedAt: new Date(),
          })
          .where(and(inArray(projectNodes.id, nodeIds), eq(projectNodes.projectId, projectId)));
      }

      if (nodeIds.length > 0) {
        for (const nodeId of nodeIds) {
          await recordNodeEvent(projectId, user.id, nodeId, "extension_task_push", {
            taskId,
            taskAction,
            filesCount: pushedFiles.length,
            nodeIds,
          }, tx);
        }
      } else {
        await recordNodeEvent(projectId, user.id, null, "extension_task_push", {
          taskId,
          taskAction,
          filesCount: pushedFiles.length,
          nodeIds,
        }, tx);
      }

      return created;
    });

    const successData = {
      success: true,
      data: {
        pushId: pushRow.id,
        timestamp: pushRow.pushedAt.toISOString(),
        filesCount: pushRow.filesCount,
      },
    };
    const successBody = JSON.stringify({ success: true, data: successData });
    await saveIdempotencyResult(
      request,
      "extension.task-push.post",
      successBody,
      idempotencyCheck.lockToken,
      idempotencyScope
    );

    return jsonSuccess(successData);
  } catch (error) {
    logger.error("[api/v1/extension/task-push] Failed to record task push", {
      error: error instanceof Error ? error.message : String(error)
    });
    return jsonError(
      error instanceof Error ? error.message : "Failed to record task push",
      500,
      "INTERNAL_ERROR"
    );
  }
}
