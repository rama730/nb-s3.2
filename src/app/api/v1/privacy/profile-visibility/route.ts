import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import {
  isProfileNotFoundError,
  updateProfileVisibilitySetting,
} from "@/lib/privacy/settings";

const VALID_PROFILE_VISIBILITY = new Set(["public", "connections", "private"]);

export async function PATCH(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:privacy:profile-visibility:patch", 60, 60);
  if (limitResponse) return limitResponse;

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const body = await request.json().catch(() => null);
    const nextVisibility = typeof body?.visibility === "string" ? body.visibility : null;
    if (!nextVisibility || !VALID_PROFILE_VISIBILITY.has(nextVisibility)) {
      return jsonError("Invalid profile visibility", 400, "BAD_REQUEST");
    }

    const result = await updateProfileVisibilitySetting({
      userId: auth.user.id,
      nextValue: nextVisibility as "public" | "connections" | "private",
      request,
    });

    logApiRoute(request, {
      requestId,
      action: "privacy.profile_visibility.patch",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ visibility: result.nextValue });
  } catch (error) {
    console.error("[api/v1/privacy/profile-visibility] failed", error);
    if (isProfileNotFoundError(error)) {
      return jsonError("Profile not found", 404, "NOT_FOUND");
    }
    return jsonError("Failed to update profile visibility", 500, "INTERNAL_ERROR");
  }
}
