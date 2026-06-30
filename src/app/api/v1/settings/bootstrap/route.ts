import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { getSettingsBootstrapForViewer } from "@/lib/settings/bootstrap";
import { logger } from "@/lib/logger";

const SETTINGS_BOOTSTRAP_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60, stale-while-revalidate=240",
  Vary: "Cookie",
} as const;

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(
    request,
    "api:v1:settings:bootstrap:get",
    60,
    60,
  );
  if (limitResponse) return limitResponse;

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const data = await getSettingsBootstrapForViewer({
      supabase: auth.supabase,
      user: auth.user,
    });

    logApiRoute(request, {
      requestId,
      action: "settings.bootstrap.get",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });

    return jsonSuccess(data, undefined, {
      headers: SETTINGS_BOOTSTRAP_CACHE_HEADERS,
    });
  } catch (error) {
    logger.error("[api/v1/settings/bootstrap] failed", {
      module: "api",
      error: error instanceof Error ? error.message : String(error),
    });
    logApiRoute(request, {
      requestId,
      action: "settings.bootstrap.get",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError(
      "Failed to load settings bootstrap",
      500,
      "INTERNAL_ERROR",
    );
  }
}
