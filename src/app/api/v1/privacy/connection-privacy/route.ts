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

const VALID_CONNECTION_PRIVACY = new Set(["everyone", "mutuals_only", "nobody"]);

export async function PATCH(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
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

    const [current] = await db
      .select({ connectionPrivacy: profiles.connectionPrivacy })
      .from(profiles)
      .where(eq(profiles.id, auth.user.id))
      .limit(1);

    await db
      .update(profiles)
      .set({
        connectionPrivacy: nextValue as "everyone" | "mutuals_only" | "nobody",
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, auth.user.id));

    await recordPrivacyEvent({
      userId: auth.user.id,
      eventType: "connection_privacy_changed",
      request,
      previousValue: { connectionPrivacy: current?.connectionPrivacy ?? "everyone" },
      nextValue: { connectionPrivacy: nextValue },
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
    console.error("[api/v1/privacy/connection-privacy] failed", error);
    return jsonError("Failed to update connection request privacy", 500, "INTERNAL_ERROR");
  }
}
