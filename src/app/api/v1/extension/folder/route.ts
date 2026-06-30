import { requireAuthenticatedUser, jsonSuccess, jsonError } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { projectNodes, taskNodeLinks, tasks } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { eq, and, inArray, isNull, gt, or } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { z } from "zod";

const folderCursorSchema = z.object({
  type: z.enum(["file", "folder"]),
  name: z.string(),
  id: z.string().uuid(),
});

const folderQuerySchema = z.object({
  projectId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().max(2048).optional(),
});

function decodeFolderCursor(value: string | undefined) {
  if (!value) return null;
  try {
    return folderCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

function encodeFolderCursor(value: { type: string; name: string; id: string }) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

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
    const rawParentId = searchParams.get("parentId")?.trim();
    const parsedQuery = folderQuerySchema.safeParse({
      projectId: searchParams.get("projectId")?.trim(),
      parentId: rawParentId && rawParentId !== "null" && rawParentId !== "undefined" ? rawParentId : null,
      limit: searchParams.get("limit") ?? undefined,
      cursor: searchParams.get("cursor")?.trim() || undefined,
    });
    if (!parsedQuery.success) return jsonError("Invalid folder query", 400, "BAD_REQUEST");

    const { projectId, parentId, limit, cursor: rawCursor } = parsedQuery.data;
    const cursor = decodeFolderCursor(rawCursor);
    if (rawCursor && !cursor) return jsonError("Invalid folder cursor", 400, "BAD_REQUEST");

    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project) {
      return jsonError("Project not found", 404, "NOT_FOUND");
    }
    if (!access.canRead) {
      return jsonError("Forbidden", 403, "FORBIDDEN");
    }

    // Find the child nodes
    const rows = await db.query.projectNodes.findMany({
      where: and(
        eq(projectNodes.projectId, projectId),
        parentId ? eq(projectNodes.parentId, parentId) : isNull(projectNodes.parentId),
        isNull(projectNodes.deletedAt),
        cursor
          ? or(
              gt(projectNodes.type, cursor.type),
              and(eq(projectNodes.type, cursor.type), gt(projectNodes.name, cursor.name)),
              and(
                eq(projectNodes.type, cursor.type),
                eq(projectNodes.name, cursor.name),
                gt(projectNodes.id, cursor.id),
              ),
            )
          : undefined,
      ),
      orderBy: (n, { asc }) => [asc(n.type), asc(n.name), asc(n.id)],
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const children = hasMore ? rows.slice(0, limit) : rows;
    const lastChild = children.at(-1);
    const nextCursor = hasMore && lastChild
      ? encodeFolderCursor({ type: lastChild.type, name: lastChild.name, id: lastChild.id })
      : null;

    const childIds = children.map((n) => n.id);
    const linkedTaskRows = childIds.length
      ? await db
          .select({
            nodeId: taskNodeLinks.nodeId,
            taskId: taskNodeLinks.taskId,
            title: tasks.title,
            taskNumber: tasks.taskNumber,
          })
          .from(taskNodeLinks)
          .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
          .where(
            and(
              inArray(taskNodeLinks.nodeId, childIds),
              eq(tasks.projectId, projectId),
              isNull(tasks.deletedAt)
            )
          )
      : [];

    const linkedTaskMap = new Map<string, Array<{ id: string; title: string | null; taskNumber: number | null }>>();
    for (const row of linkedTaskRows) {
      const existing = linkedTaskMap.get(row.nodeId) ?? [];
      existing.push({
        id: row.taskId,
        title: row.title,
        taskNumber: row.taskNumber,
      });
      linkedTaskMap.set(row.nodeId, existing);
    }

    return jsonSuccess({
      children: children.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        path: n.path,
        s3Key: n.s3Key,
        size: n.size,
        mimeType: n.mimeType,
        currentVersion: n.currentVersion,
        syncStatus: n.syncStatus,
        linkedTasks: linkedTaskMap.get(n.id) ?? [],
        updatedAt: n.updatedAt?.toISOString?.() ?? n.updatedAt,
      })),
      nextCursor,
      hasMore,
    });
  } catch (error) {
    logger.error("[api/v1/extension/folder] Failed to get folder content", {
      error: error instanceof Error ? error.message : String(error)
    });
    return jsonError("Failed to get folder content", 500, "INTERNAL_ERROR");
  }
}
