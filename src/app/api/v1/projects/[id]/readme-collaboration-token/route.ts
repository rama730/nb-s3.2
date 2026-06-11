import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import {
  enforceRouteLimit,
  getSessionIdentifier,
  getRequestId,
  jsonError,
  jsonSuccess,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { projectMembers, projectReadmes, projects } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import {
  createReadmeCollaborationTokenClaims,
  MISSING_README_COLLABORATION_SECRET_ERROR_CODE,
  MissingReadmeCollaborationSecretError,
  signReadmeCollaborationToken,
} from "@/lib/realtime/readme-collaboration-token";
import { resolveProjectReadmePermission } from "@/lib/projects/readme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const { id: projectId } = await context.params;

  if (!UUID_RE.test(projectId)) {
    return jsonError("Not found", 404, "NOT_FOUND");
  }

  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

    const limitResponse = await enforceRouteLimit(
      request,
      `api:v1:projects:readmeCollaborationToken:${auth.user.id}:${projectId}`,
      30,
      60,
    );
    if (limitResponse) return limitResponse;

    const [row] = await db
      .select({
        ownerId: projects.ownerId,
        visibility: projects.visibility,
        publicTabVisibility: projects.publicTabVisibility,
        memberRole: projectMembers.role,
        readmeSettings: projectReadmes.settings,
        readmePublishedVersionId: projectReadmes.publishedVersionId,
      })
      .from(projects)
      .leftJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projects.id),
          eq(projectMembers.userId, auth.user.id),
        ),
      )
      .leftJoin(projectReadmes, eq(projectReadmes.projectId, projects.id))
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);

    if (!row) {
      return jsonError("Not found", 404, "NOT_FOUND");
    }

    const isOwner = row.ownerId === auth.user.id;
    const permission = resolveProjectReadmePermission({
      actorUserId: auth.user.id,
      projectVisibility: row.visibility,
      publicTabVisibility: row.publicTabVisibility,
      settings: row.readmeSettings,
      membershipRole: isOwner ? "owner" : row.memberRole,
      isOwner,
      isActiveMember: isOwner || Boolean(row.memberRole),
      hasPublishedReadme: Boolean(row.readmePublishedVersionId),
    });

    if (!permission.canEdit) {
      return jsonError("You do not have access to edit this README.", 403, "FORBIDDEN");
    }

    const {
      data: { session },
    } = await auth.supabase.auth.getSession();
    const claims = createReadmeCollaborationTokenClaims({
      userId: auth.user.id,
      sessionId: getSessionIdentifier(session),
      projectId,
    });
    const token = signReadmeCollaborationToken(claims);

    logger.metric("readme_collaboration.token.issued", {
      requestId,
      projectId,
      userId: auth.user.id,
      durationMs: Date.now() - startedAt,
    });

    return jsonSuccess({
      token,
      expiresAt: claims.exp,
      documentName: claims.documentName,
    });
  } catch (error) {
    logger.error("readme_collaboration.token.issue_failed", {
      requestId,
      projectId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });

    if (
      error instanceof MissingReadmeCollaborationSecretError
      || (typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === MISSING_README_COLLABORATION_SECRET_ERROR_CODE)
    ) {
      return jsonError("README collaboration service is not configured.", 503, "UNAVAILABLE");
    }

    return jsonError("Failed to issue README collaboration token", 500, "INTERNAL_ERROR");
  }
}
