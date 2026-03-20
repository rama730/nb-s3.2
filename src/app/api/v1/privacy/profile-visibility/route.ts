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

    const [current] = await db
      .select({ visibility: profiles.visibility })
      .from(profiles)
      .where(eq(profiles.id, auth.user.id))
      .limit(1);

    await db
      .update(profiles)
      .set({
        visibility: nextVisibility as "public" | "connections" | "private",
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, auth.user.id));

    await recordPrivacyEvent({
      userId: auth.user.id,
      eventType: "profile_visibility_changed",
      request,
      previousValue: { visibility: current?.visibility ?? "public" },
      nextValue: { visibility: nextVisibility },
    });

    logApiRoute(request, {
      requestId,
      action: "privacy.profile_visibility.patch",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ visibility: nextVisibility });
  } catch (error) {
    console.error("[api/v1/privacy/profile-visibility] failed", error);
    return jsonError("Failed to update profile visibility", 500, "INTERNAL_ERROR");
  }
}
