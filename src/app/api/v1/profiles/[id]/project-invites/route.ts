import { z } from "zod";

import { sendStructuredMessageActionV2 } from "@/app/actions/messaging/collaboration";
import { enforceRouteLimit, getRequestId, jsonError, jsonSuccess, logApiRoute, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { validateCsrf } from "@/lib/security/csrf";
import { getProfileInviteProjectOptions } from "@/lib/profile/collaboration";
import { logger } from "@/lib/logger";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const inviteSchema = z.object({
  projectId: z.string().regex(UUID_PATTERN),
  note: z.string().trim().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
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
    const options = await getProfileInviteProjectOptions(auth.user.id, id);
    const selected = options.find((project) => project.id === parsed.data.projectId);
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

    const result = await sendStructuredMessageActionV2({
      targetUserId: id,
      kind: "project_invite",
      projectId: selected.id,
      title: "Project invite",
      summary: `Invitation to join ${selected.title}`,
      note: parsed.data.note ?? null,
      contextChips: [{
        kind: "project",
        id: selected.id,
        label: selected.title,
        subtitle: selected.slug ? `/${selected.slug}` : null,
      }],
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
      conversationId: result.conversationId,
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
