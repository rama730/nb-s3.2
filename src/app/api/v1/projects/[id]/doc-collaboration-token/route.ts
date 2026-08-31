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
import { projectMembers, projectMarkdowns, projects } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import {
  createDocCollaborationTokenClaims,
  MISSING_DOC_COLLABORATION_SECRET_ERROR_CODE,
  MissingDocCollaborationSecretError,
  signDocCollaborationToken,
} from "@/lib/realtime/doc-collaboration-token";
import { resolveProjectDocPermission } from "@/lib/projects/doc";
import { isUuid } from "@/lib/validations/uuid";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const { id: projectId } = await context.params;

  if (!isUuid(projectId)) {
    return jsonError("Not found", 404, "NOT_FOUND");
  }

  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

    const reqBody = await request.json().catch(() => null) || {};
    const docSlug = reqBody.docSlug || request.nextUrl.searchParams.get("doc") || "readme";

    const limitResponse = await enforceRouteLimit(
      request,
      `api:v1:projects:readmeCollaborationToken:${auth.user.id}:${projectId}:${docSlug}`,
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
        readmeSettings: projectMarkdowns.settings,
        readmePublishedVersionId: projectMarkdowns.publishedVersionId,
      })
      .from(projects)
      .leftJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projects.id),
          eq(projectMembers.userId, auth.user.id),
        ),
      )
      .leftJoin(projectMarkdowns, and(eq(projectMarkdowns.projectId, projects.id), eq(projectMarkdowns.slug, docSlug)))
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);

    if (!row) {
      return jsonError("Not found", 404, "NOT_FOUND");
    }

    const isOwner = row.ownerId === auth.user.id;
    const permission = resolveProjectDocPermission({
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
      return jsonError("You do not have access to edit this document.", 403, "FORBIDDEN");
    }

    const {
      data: { session },
    } = await auth.supabase.auth.getSession();
    const claims = createDocCollaborationTokenClaims({
      userId: auth.user.id,
      sessionId: getSessionIdentifier(session),
      projectId,
      docSlug,
    });
    const token = signDocCollaborationToken(claims);

    logger.metric("readme_collaboration.token.issued", {
      requestId,
      projectId,
      docSlug,
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
      error instanceof MissingDocCollaborationSecretError
      || (typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === MISSING_DOC_COLLABORATION_SECRET_ERROR_CODE)
    ) {
      return jsonError("Doc collaboration service is not configured.", 503, "UNAVAILABLE");
    }

    return jsonError("Failed to issue Doc collaboration token", 500, "INTERNAL_ERROR");
  }
}
