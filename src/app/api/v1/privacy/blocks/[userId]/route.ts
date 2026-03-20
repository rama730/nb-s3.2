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
import { unblockUser } from "@/lib/privacy/blocks";

export async function DELETE(request: Request, context: { params: Promise<{ userId: string }> }) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:privacy:blocks:delete", 60, 60);
  if (limitResponse) return limitResponse;

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const { userId } = await context.params;
    if (!userId) return jsonError("User is required", 400, "BAD_REQUEST");

    const [target] = await db
      .select({ id: profiles.id, username: profiles.username })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    if (!target) return jsonError("User not found", 404, "NOT_FOUND");

    await unblockUser(auth.user.id, userId);
    await recordPrivacyEvent({
      userId: auth.user.id,
      eventType: "account_unblocked",
      request,
      metadata: { targetUserId: userId, targetUsername: target.username ?? null },
    });
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
    console.error("[api/v1/privacy/blocks/[userId]] failed", error);
    logger.metric("privacy.block.result", {
      viewerId: auth.user.id,
      success: false,
      action: "unblock",
    });
    return jsonError("Failed to unblock account", 500, "INTERNAL_ERROR");
  }
}
