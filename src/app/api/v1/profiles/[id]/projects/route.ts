import { getRequestId, jsonError, jsonSuccess, logApiRoute } from "@/app/api/v1/_shared";
import { createClient } from "@/lib/supabase/server";
import { resolvePrivacyRelationship } from "@/lib/privacy/resolver";
import { getProfilePortfolioProjects } from "@/lib/profile/collaboration";
import { logger } from "@/lib/logger";
import { isUuid } from "@/lib/validations/uuid";
import { z } from "zod";

const querySchema = z.object({
  limit: z.coerce.number().int().catch(12).transform((value) => Math.min(Math.max(value, 0), 48)),
  offset: z.coerce.number().int().catch(0).transform((value) => Math.min(Math.max(value, 0), 5_000)),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const { id } = await params;
  if (!isUuid(id)) {
    return jsonError("Invalid profile id", 400, "BAD_REQUEST");
  }

  try {
    const url = new URL(request.url);
    const { limit, offset } = querySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const viewerId = data.user?.id ?? null;
    const relationship = await resolvePrivacyRelationship(viewerId, id);
    if (!relationship) {
      return jsonError("Profile not found", 404, "NOT_FOUND");
    }
    if (!relationship.canViewProfile) {
      logApiRoute(request, {
        requestId,
        action: "profiles.projects.get",
        userId: viewerId,
        startedAt,
        success: false,
        status: 403,
        errorCode: "FORBIDDEN",
      });
      return jsonError("Profile is not viewable", 403, "FORBIDDEN");
    }

    const isOwner = viewerId === id;
    const result = await getProfilePortfolioProjects(id, {
      includePrivate: isOwner,
      limit,
      offset,
    });
    logApiRoute(request, {
      requestId,
      action: "profiles.projects.get",
      userId: viewerId,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(
      result,
      undefined,
      {
        headers: !viewerId
          ? { "Cache-Control": "public, max-age=60, stale-while-revalidate=600" }
          : { "Cache-Control": "private, max-age=60, stale-while-revalidate=300", Vary: "Cookie" },
      },
    );
  } catch (error) {
    logger.error("[api/v1/profiles/projects] failed", {
      module: "api",
      profileId: id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logApiRoute(request, {
      requestId,
      action: "profiles.projects.get",
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to load profile projects", 500, "INTERNAL_ERROR");
  }
}
