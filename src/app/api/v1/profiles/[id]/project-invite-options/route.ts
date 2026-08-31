import { enforceRouteLimit, getRequestId, jsonError, jsonSuccess, logApiRoute, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { getProfileInviteProjectOptions } from "@/lib/profile/collaboration";
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

  const limitResponse = await enforceRouteLimit(request, "api:v1:profiles:project-invite-options", 120, 60);
  if (limitResponse) return limitResponse;

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const url = new URL(request.url);
    const page = await getProfileInviteProjectOptions(auth.user.id, id, {
      search: url.searchParams.get("search") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: Number(url.searchParams.get("limit") || 20),
    });
    logApiRoute(request, {
      requestId,
      action: "profiles.projectInviteOptions.get",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(
      page,
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
