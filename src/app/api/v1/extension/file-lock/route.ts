import { requireAuthenticatedUser, jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { profiles, projectNodeLocks, projectNodes } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { and, eq, gt, isNull } from "drizzle-orm";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveEditableNode(projectId: string, path: string, userId: string) {
  if (!projectId || !path) {
    return { error: jsonError("Missing projectId or path", 400, "BAD_REQUEST") };
  }

  const access = await getProjectAccessById(projectId, userId);
  if (!access.project) return { error: jsonError("Project not found", 404, "NOT_FOUND") };
  if (!access.canWrite) return { error: jsonError("Forbidden", 403, "FORBIDDEN") };

  const node = await db.query.projectNodes.findFirst({
    where: and(
      eq(projectNodes.projectId, projectId),
      eq(projectNodes.path, path),
      eq(projectNodes.type, "file"),
      isNull(projectNodes.deletedAt),
    ),
    columns: { id: true, projectId: true, path: true },
  });

  if (!node) return { error: jsonError("File not found", 404, "NOT_FOUND") };
  return { node };
}

export async function POST(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) return authResult.response;
    const user = authResult.user;
    if (!user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

    const body = await request.json().catch(() => ({}));
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const path = typeof body.path === "string" ? body.path.trim() : "";
    const ttlMs = Math.max(30_000, Math.min(180_000, Number(body.ttlMs || 90_000)));
    const resolved = await resolveEditableNode(projectId, path, user.id);
    if (resolved.error) return resolved.error;
    const node = resolved.node!;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const activeLock = await db.query.projectNodeLocks.findFirst({
      where: and(
        eq(projectNodeLocks.nodeId, node.id),
        gt(projectNodeLocks.expiresAt, now),
      ),
    });

    if (activeLock && activeLock.lockedBy !== user.id) {
      const holder = await db.query.profiles.findFirst({
        where: eq(profiles.id, activeLock.lockedBy),
        columns: { fullName: true, username: true },
      });
      return jsonError(
        `File is locked by ${holder?.fullName || holder?.username || "another collaborator"}.`,
        423,
        "CONFLICT",
      );
    }

    await db
      .insert(projectNodeLocks)
      .values({
        nodeId: node.id,
        projectId,
        lockedBy: user.id,
        acquiredAt: now,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: projectNodeLocks.nodeId,
        set: {
          projectId,
          lockedBy: user.id,
          acquiredAt: now,
          expiresAt,
        },
      });

    return jsonSuccess({
      nodeId: node.id,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    logger.error("[api/v1/extension/file-lock] Failed to acquire lock", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError("Failed to acquire file lock", 500, "INTERNAL_ERROR");
  }
}

export async function DELETE(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) return authResult.response;
    const user = authResult.user;
    if (!user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

    const body = await request.json().catch(() => ({}));
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const path = typeof body.path === "string" ? body.path.trim() : "";
    const resolved = await resolveEditableNode(projectId, path, user.id);
    if (resolved.error) return resolved.error;
    const node = resolved.node!;

    await db
      .delete(projectNodeLocks)
      .where(
        and(
          eq(projectNodeLocks.nodeId, node.id),
          eq(projectNodeLocks.projectId, projectId),
          eq(projectNodeLocks.lockedBy, user.id),
        ),
      );

    return jsonSuccess({ released: true, nodeId: node.id });
  } catch (error) {
    logger.error("[api/v1/extension/file-lock] Failed to release lock", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError("Failed to release file lock", 500, "INTERNAL_ERROR");
  }
}
