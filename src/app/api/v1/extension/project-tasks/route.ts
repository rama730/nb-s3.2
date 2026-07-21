import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { getProjectTaskSummary, getTaskFileCountMap } from "@/app/api/v1/extension/_project-counts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cursorSchema = z.object({
  updatedAt: z.string().datetime(),
  id: z.string().uuid(),
});

const querySchema = z.object({
  projectId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(2048).optional(),
});

function decodeCursor(value: string | undefined) {
  if (!value) return null;
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
}

function encodeCursor(value: { updatedAt: Date; id: string }) {
  return Buffer.from(
    JSON.stringify({ updatedAt: value.updatedAt.toISOString(), id: value.id }),
  ).toString("base64url");
}

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) return authResult.response;
    const user = authResult.user;
    if (!user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

    const searchParams = new URL(request.url).searchParams;
    const parsed = querySchema.safeParse({
      projectId: searchParams.get("projectId")?.trim(),
      limit: searchParams.get("limit") ?? undefined,
      cursor: searchParams.get("cursor")?.trim() || undefined,
    });
    if (!parsed.success)
      return jsonError("Invalid project task query", 400, "BAD_REQUEST");

    const cursor = decodeCursor(parsed.data.cursor);
    if (parsed.data.cursor && !cursor)
      return jsonError("Invalid task cursor", 400, "BAD_REQUEST");
    const { projectId, limit } = parsed.data;
    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project)
      return jsonError("Project not found", 404, "NOT_FOUND");
    if (!access.canRead) return jsonError("Forbidden", 403, "FORBIDDEN");

    const cursorDate = cursor ? new Date(cursor.updatedAt) : null;
    const [taskRows, summary] = await Promise.all([
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          taskNumber: tasks.taskNumber,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
            cursor && cursorDate
              ? or(
                  lt(tasks.updatedAt, cursorDate),
                  and(eq(tasks.updatedAt, cursorDate), lt(tasks.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(tasks.updatedAt), desc(tasks.id))
        .limit(limit + 1),
      getProjectTaskSummary(projectId),
    ]);

    const hasMore = taskRows.length > limit;
    const page = hasMore ? taskRows.slice(0, limit) : taskRows;
    const taskIds = page.map((task) => task.id);
    const fileCountMap = await getTaskFileCountMap(projectId, taskIds);
    const lastTask = page.at(-1);

    return jsonSuccess({
      projectId,
      tasks: page.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        taskNumber: task.taskNumber,
        filesCount: fileCountMap.get(task.id) || 0,
        updatedAt: task.updatedAt.toISOString(),
      })),
      totalCount: summary.taskCount,
      hasMore,
      nextCursor: hasMore && lastTask ? encodeCursor(lastTask) : null,
    });
  } catch (error) {
    logger.error(
      "[api/v1/extension/project-tasks] Failed to get project tasks",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return jsonError("Failed to get project tasks", 500, "INTERNAL_ERROR");
  }
}
