import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { getProjectTaskSummary, getTaskFileCountMap } from "@/app/api/v1/extension/_project-counts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  projectId: z.string().uuid(),
});

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) return authResult.response;
    const user = authResult.user;
    if (!user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

    const parsed = querySchema.safeParse({
      projectId: new URL(request.url).searchParams.get("projectId")?.trim(),
    });
    if (!parsed.success)
      return jsonError("Invalid project id", 400, "BAD_REQUEST");

    const { projectId } = parsed.data;
    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project)
      return jsonError("Project not found", 404, "NOT_FOUND");
    if (!access.canRead) return jsonError("Forbidden", 403, "FORBIDDEN");

    const summary = await getProjectTaskSummary(projectId);
    const taskCount = summary.taskCount;

    let associatedTaskPreview: {
      id: string;
      title: string;
      description: string | null;
      status: string;
      priority: string;
      taskNumber: number | null;
      filesCount: number;
    } | null = null;

    if (taskCount === 1) {
      const [task] = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          taskNumber: tasks.taskNumber,
        })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
        .limit(1);

      if (task) {
        const fileCounts = await getTaskFileCountMap(projectId, [task.id]);
        associatedTaskPreview = {
          ...task,
          filesCount: fileCounts.get(task.id) || 0,
        };
      }
    }

    const lastUpdated = summary.lastTaskUpdatedAt
      ? new Date(summary.lastTaskUpdatedAt).toISOString()
      : "none";
    const summaryVersion = `${taskCount}:${lastUpdated}`;
    const etag = `"${Buffer.from(summaryVersion).toString("base64url")}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": "private, no-cache" },
      });
    }

    return jsonSuccess(
      { projectId, taskCount, associatedTaskPreview, summaryVersion },
      undefined,
      { headers: { ETag: etag, "Cache-Control": "private, no-cache" } },
    );
  } catch (error) {
    logger.error(
      "[api/v1/extension/project-summary] Failed to get project summary",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return jsonError("Failed to get project summary", 500, "INTERNAL_ERROR");
  }
}
