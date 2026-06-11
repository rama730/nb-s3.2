import { z } from "zod";

import { enforceRouteLimit, getRequestId, jsonError, jsonSuccess, logApiRoute, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { validateCsrf } from "@/lib/security/csrf";
import { updateProfileProjectContributionStage } from "@/lib/profile/collaboration";
import { logger } from "@/lib/logger";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const stageUpdateSchema = z.object({
  roleTitle: z.string().trim().min(1).max(100).optional(),
  summary: z.string().trim().max(700).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(60)).max(24).optional(),
  visibility: z.enum(["public", "private"]).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required",
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const { id, stageId } = await params;

  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(stageId)) {
    return jsonError("Invalid profile stage request", 400, "BAD_REQUEST");
  }

  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }
  if (auth.user.id !== id) {
    return jsonError("You can only edit your own profile contribution history", 403, "FORBIDDEN");
  }

  const limitResponse = await enforceRouteLimit(request, `api:v1:profiles:collaboration-stages:${auth.user.id}`, 40, 60);
  if (limitResponse) return limitResponse;

  const body = await request.json().catch(() => null);
  const parsed = stageUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid contribution stage update", 400, "BAD_REQUEST", parsed.error.flatten());
  }

  try {
    const updated = await updateProfileProjectContributionStage(id, stageId, parsed.data);
    if (!updated) {
      logApiRoute(request, {
        requestId,
        action: "profiles.collaborationStages.patch",
        userId: auth.user.id,
        startedAt,
        success: false,
        status: 404,
        errorCode: "NOT_FOUND",
      });
      return jsonError("Contribution stage not found", 404, "NOT_FOUND");
    }

    logApiRoute(request, {
      requestId,
      action: "profiles.collaborationStages.patch",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ stage: updated }, "Contribution stage updated");
  } catch (error) {
    logger.error("[api/v1/profiles/collaboration-stages] failed", {
      module: "api",
      userId: auth.user.id,
      subjectUserId: id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logApiRoute(request, {
      requestId,
      action: "profiles.collaborationStages.patch",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to update contribution stage", 500, "INTERNAL_ERROR");
  }
}
