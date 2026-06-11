import { enforceRouteLimit, getRequestId, jsonError, jsonSuccess, logApiRoute, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { getProfileInviteProjectOptions } from "@/lib/profile/collaboration";
import { logger } from "@/lib/logger";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return jsonError("Invalid profile id", 400, "BAD_REQUEST");
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:profiles:project-invite-options", 120, 60);
  if (limitResponse) return limitResponse;

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const projects = await getProfileInviteProjectOptions(auth.user.id, id);
    logApiRoute(request, {
      requestId,
      action: "profiles.projectInviteOptions.get",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(
      { projects },
      undefined,
      { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120", Vary: "Cookie" } },
    );
  } catch (error) {
    logger.error("[api/v1/profiles/project-invite-options] failed", {
      module: "api",
      profileId: id,
      userId: auth.user.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logApiRoute(request, {
      requestId,
      action: "profiles.projectInviteOptions.get",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to load invite options", 500, "INTERNAL_ERROR");
  }
}
