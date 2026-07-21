import { z } from "zod";

import { getRequestId, jsonError, jsonSuccess, logApiRoute } from "@/app/api/v1/_shared";
import { logger } from "@/lib/logger";
import { resolvePrivacyRelationship } from "@/lib/privacy/resolver";
import { getProfileContributions } from "@/lib/profile/collaboration";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validations/uuid";

const querySchema = z.object({
  limit: z.coerce.number().int().catch(24).transform((value) => Math.min(Math.max(value, 1), 50)),
  offset: z.coerce.number().int().catch(0).transform((value) => Math.min(Math.max(value, 0), 5_000)),
  stageLimit: z.coerce.number().int().catch(8).transform((value) => Math.min(Math.max(value, 1), 20)),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Invalid profile id", 400, "BAD_REQUEST");

  try {
    const url = new URL(request.url);
    const query = querySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
      stageLimit: url.searchParams.get("stageLimit") ?? undefined,
    });
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const viewerId = data.user?.id ?? null;
    const relationship = await resolvePrivacyRelationship(viewerId, id);
    if (!relationship) return jsonError("Profile not found", 404, "NOT_FOUND");
    if (!relationship.canViewProfile) return jsonError("Profile is not viewable", 403, "FORBIDDEN");

    const result = await getProfileContributions(id, {
      includePrivate: viewerId === id,
      limit: query.limit,
      offset: query.offset,
      stageLimit: query.stageLimit,
    });
    logApiRoute(request, {
      requestId,
      action: "profiles.contributions.get",
      userId: viewerId,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(result, undefined, {
      // Visibility changes are privacy-sensitive. The database summary cache is
      // invalidated transactionally; browsers and shared proxies must not retain
      // an older public representation after the owner makes an item private.
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  } catch (error) {
    logger.error("[api/v1/profiles/contributions] failed", {
      module: "api",
      profileId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    logApiRoute(request, {
      requestId,
      action: "profiles.contributions.get",
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to load profile contributions", 500, "INTERNAL_ERROR");
  }
}
