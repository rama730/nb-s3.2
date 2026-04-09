import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { logger } from "@/lib/logger";
import {
  isProfileNotFoundError,
  updateConnectionPrivacySetting,
} from "@/lib/privacy/settings";
import { validateCsrf } from "@/lib/security/csrf";

const VALID_CONNECTION_PRIVACY = new Set(["everyone", "mutuals_only", "nobody"]);

export async function PATCH(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  const limitResponse = await enforceRouteLimit(request, "api:v1:privacy:connection-privacy:patch", 60, 60);
  if (limitResponse) return limitResponse;

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const body = await request.json().catch(() => null);
    const nextValue = typeof body?.connectionPrivacy === "string" ? body.connectionPrivacy : null;
    if (!nextValue || !VALID_CONNECTION_PRIVACY.has(nextValue)) {
      return jsonError("Invalid connection request privacy", 400, "BAD_REQUEST");
    }

    await updateConnectionPrivacySetting({
      userId: auth.user.id,
      nextValue: nextValue as "everyone" | "mutuals_only" | "nobody",
      request,
    });

    logApiRoute(request, {
      requestId,
      action: "privacy.connection_privacy.patch",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ connectionPrivacy: nextValue });
  } catch (error) {
    logger.error("[api/v1/privacy/connection-privacy] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    if (isProfileNotFoundError(error)) {
      return jsonError("Profile not found", 404, "NOT_FOUND");
    }
    return jsonError("Failed to update connection request privacy", 500, "INTERNAL_ERROR");
  }
}
