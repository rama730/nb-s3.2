import { z } from "zod";

import { createProjectInvitationAction } from "@/app/actions/project/guidance";
import { enforceRouteLimit, getRequestId, jsonError, jsonSuccess, logApiRoute, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { validateCsrf } from "@/lib/security/csrf";
import { getProfileInviteProjectOptions } from "@/lib/profile/collaboration";
import { logger } from "@/lib/logger";
import { isUuid } from "@/lib/validations/uuid";

const inviteSchema = z.object({
  projectId: z.string().uuid(),
  kind: z.enum(["ordinary_role", "guidance_appointment"]).default("ordinary_role"),
  roleId: z.string().uuid().nullable().optional(),
  guidanceLabel: z.string().trim().max(60).nullable().optional(),
  reviewAt: z.string().trim().max(40).nullable().optional(),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().max(160).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const { id } = await params;
  if (!isUuid(id)) {
    return jsonError("Invalid profile id", 400, "BAD_REQUEST");
  }

  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }
  if (auth.user.id === id) {
    return jsonError("Choose another collaborator to invite", 400, "BAD_REQUEST");
  }

  const limitResponse = await enforceRouteLimit(request, `api:v1:profiles:project-invites:${auth.user.id}`, 30, 60);
  if (limitResponse) return limitResponse;

  const body = await request.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid invite request", 400, "BAD_REQUEST");
  }

  try {
    const options = await getProfileInviteProjectOptions(auth.user.id, id, {
      projectId: parsed.data.projectId,
      limit: 1,
    });
    const selected = options.projects[0];
    if (!selected) {
      logApiRoute(request, {
        requestId,
        action: "profiles.projectInvites.post",
        userId: auth.user.id,
        startedAt,
        success: false,
        status: 403,
        errorCode: "FORBIDDEN",
      });
      return jsonError("You can only invite this profile to projects you manage", 403, "FORBIDDEN");
    }

    const result = await createProjectInvitationAction({
      projectId: selected.id,
      candidateId: id,
      kind: parsed.data.kind,
      roleId: parsed.data.roleId ?? null,
      guidanceLabel: parsed.data.guidanceLabel ?? null,
      reviewAt: parsed.data.reviewAt ?? null,
      note: parsed.data.note ?? null,
      idempotencyKey: parsed.data.idempotencyKey ?? crypto.randomUUID(),
    });

    if (!result.success) {
      logApiRoute(request, {
        requestId,
        action: "profiles.projectInvites.post",
        userId: auth.user.id,
        startedAt,
        success: false,
        status: 400,
        errorCode: "BAD_REQUEST",
      });
      return jsonError(result.error || "Failed to send invite", 400, "BAD_REQUEST");
    }

    logApiRoute(request, {
      requestId,
      action: "profiles.projectInvites.post",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({
      invitationId: result.invitationId,
      project: selected,
    }, "Project invite sent");
  } catch (error) {
    logger.error("[api/v1/profiles/project-invites] failed", {
      module: "api",
      profileId: id,
      userId: auth.user.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logApiRoute(request, {
      requestId,
      action: "profiles.projectInvites.post",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to send project invite", 500, "INTERNAL_ERROR");
  }
}
