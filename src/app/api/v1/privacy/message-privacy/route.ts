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
  updateMessagePrivacySetting,
} from "@/lib/privacy/settings";
import { validateCsrf } from "@/lib/security/csrf";

const VALID_MESSAGE_PRIVACY = new Set(["everyone", "connections"]);

export async function PATCH(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = await validateCsrf(request);
  if (csrfError) return csrfError;
  const limitResponse = await enforceRouteLimit(request, "api:v1:privacy:message-privacy:patch", 60, 60);
  if (limitResponse) return limitResponse;

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const body = await request.json().catch(() => null);
    const nextValue = typeof body?.messagePrivacy === "string" ? body.messagePrivacy : null;
    if (!nextValue || !VALID_MESSAGE_PRIVACY.has(nextValue)) {
      return jsonError("Invalid messaging privacy", 400, "BAD_REQUEST");
    }

    await updateMessagePrivacySetting({
      userId: auth.user.id,
      nextValue: nextValue as "everyone" | "connections",
      request,
    });

    logApiRoute(request, {
      requestId,
      action: "privacy.message_privacy.patch",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ messagePrivacy: nextValue });
  } catch (error) {
    logger.error("[api/v1/privacy/message-privacy] failed", {
      module: 'api',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (isProfileNotFoundError(error)) {
      return jsonError("Profile not found", 404, "NOT_FOUND");
    }
    return jsonError("Failed to update messaging privacy", 500, "INTERNAL_ERROR");
  }
}
