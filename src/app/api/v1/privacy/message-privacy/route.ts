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
import { recordPrivacyEvent } from "@/lib/privacy/audit";

const VALID_MESSAGE_PRIVACY = new Set(["everyone", "connections"]);

export async function PATCH(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
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

    const [current] = await db
      .select({ messagePrivacy: profiles.messagePrivacy })
      .from(profiles)
      .where(eq(profiles.id, auth.user.id))
      .limit(1);

    await db
      .update(profiles)
      .set({
        messagePrivacy: nextValue as "everyone" | "connections",
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, auth.user.id));

    await recordPrivacyEvent({
      userId: auth.user.id,
      eventType: "message_privacy_changed",
      request,
      previousValue: { messagePrivacy: current?.messagePrivacy ?? "connections" },
      nextValue: { messagePrivacy: nextValue },
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
    console.error("[api/v1/privacy/message-privacy] failed", error);
    return jsonError("Failed to update messaging privacy", 500, "INTERNAL_ERROR");
  }
}
