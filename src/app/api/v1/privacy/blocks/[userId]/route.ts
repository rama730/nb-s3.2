import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { logger } from "@/lib/logger";
import { setUserBlocked } from "@/lib/privacy/blocks";
import { validateCsrf } from "@/lib/security/csrf";

export async function DELETE(request: Request, context: { params: Promise<{ userId: string }> }) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  const limitResponse = await enforceRouteLimit(request, "api:v1:privacy:blocks:delete", 60, 60);
  if (limitResponse) return limitResponse;

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  const { userId } = await context.params;
  if (!userId) return jsonError("User is required", 400, "BAD_REQUEST");

  try {
    const target = await setUserBlocked({ blockerId: auth.user.id, targetUserId: userId, blocked: false, request });
    if (!target) return jsonError("User not found", 404, "NOT_FOUND");
    logger.metric("privacy.block.result", {
      viewerId: auth.user.id,
      targetUserId: userId,
      success: true,
      action: "unblock",
    });

    logApiRoute(request, {
      requestId,
      action: "privacy.blocks.delete",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ userId, blocked: false });
  } catch (error) {
    logger.error("[api/v1/privacy/blocks/[userId]] failed", { error, requestId, targetUserId: userId });
    logger.metric("privacy.block.result", {
      viewerId: auth.user.id,
      targetUserId: userId ?? null,
      success: false,
      action: "unblock",
    });
    return jsonError("Failed to unblock account", 500, "INTERNAL_ERROR");
  }
}
