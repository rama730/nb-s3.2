import { getRequestId, jsonError, jsonSuccess, logApiRoute } from "@/app/api/v1/_shared";
import { createClient } from "@/lib/supabase/server";
import { resolvePrivacyRelationship } from "@/lib/privacy/resolver";
import { getProfileCollaborationSummary } from "@/lib/profile/collaboration";
import { logger } from "@/lib/logger";
import { isUuid } from "@/lib/validations/uuid";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const { id } = await params;
  if (!isUuid(id)) {
    return jsonError("Invalid profile id", 400, "BAD_REQUEST");
  }

  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const viewerId = data.user?.id ?? null;
    const relationship = await resolvePrivacyRelationship(viewerId, id);
    if (!relationship) {
      logApiRoute(request, {
        requestId,
        action: "profiles.collaborationSummary.get",
        startedAt,
        success: false,
        status: 404,
        errorCode: "NOT_FOUND",
      });
      return jsonError("Profile not found", 404, "NOT_FOUND");
    }
    if (!relationship.canViewProfile) {
      logApiRoute(request, {
        requestId,
        action: "profiles.collaborationSummary.get",
        userId: viewerId,
        startedAt,
        success: false,
        status: 403,
        errorCode: "FORBIDDEN",
      });
      return jsonError("Profile is not viewable", 403, "FORBIDDEN");
    }

    const isOwner = viewerId === id;
    const summary = await getProfileCollaborationSummary(id, {
      includePrivate: isOwner,
      preferCached: !isOwner,
    });
    logApiRoute(request, {
      requestId,
      action: "profiles.collaborationSummary.get",
      userId: viewerId,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(
      { summary },
      undefined,
      {
        headers: !viewerId
          ? { "Cache-Control": "public, max-age=60, stale-while-revalidate=600" }
          : { "Cache-Control": "private, max-age=60, stale-while-revalidate=300", Vary: "Cookie" },
      },
    );
  } catch (error) {
    logger.error("[api/v1/profiles/collaboration-summary] failed", {
      module: "api",
      profileId: id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logApiRoute(request, {
      requestId,
      action: "profiles.collaborationSummary.get",
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to load collaboration summary", 500, "INTERNAL_ERROR");
  }
}
