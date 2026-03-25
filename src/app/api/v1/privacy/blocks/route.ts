import { eq } from "drizzle-orm";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { recordPrivacyEvent } from "@/lib/privacy/audit";
import { blockUser } from "@/lib/privacy/blocks";

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:privacy:blocks:post", 60, 60);
  if (limitResponse) return limitResponse;

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const body = await request.json().catch(() => null);
    const targetUserId = typeof body?.userId === "string" ? body.userId : null;
    if (!targetUserId) return jsonError("User is required", 400, "BAD_REQUEST");
    if (targetUserId === auth.user.id) return jsonError("Cannot block yourself", 400, "BAD_REQUEST");

    const [target] = await db
      .select({ id: profiles.id, username: profiles.username })
      .from(profiles)
      .where(eq(profiles.id, targetUserId))
      .limit(1);
    if (!target) return jsonError("User not found", 404, "NOT_FOUND");

    await blockUser(auth.user.id, targetUserId);
    await recordPrivacyEvent({
      userId: auth.user.id,
      eventType: "account_blocked",
      request,
      metadata: { targetUserId, targetUsername: target.username ?? null },
    });
    logger.metric("privacy.block.result", {
      viewerId: auth.user.id,
      targetUserId,
      success: true,
      action: "block",
    });

    logApiRoute(request, {
      requestId,
      action: "privacy.blocks.post",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ userId: targetUserId, blocked: true });
  } catch (error) {
    logger.error("[api/v1/privacy/blocks] failed", { error, requestId });
    logger.metric("privacy.block.result", {
      viewerId: auth.user.id,
      success: false,
      action: "block",
    });
    logApiRoute(request, {
      requestId,
      action: "privacy.blocks.post",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to block account", 500, "INTERNAL_ERROR");
  }
}
