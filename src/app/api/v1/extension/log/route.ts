import { enforceRouteLimit, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { recordExtensionMetric } from "@/lib/extension/observability";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeLogLevel(value: unknown) {
  return value === "error" || value === "warn" || value === "info" || value === "debug"
    ? value
    : "info";
}

function normalizeMessage(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

export async function POST(request: Request) {
  const limitResponse = await enforceRouteLimit(request, "api:v1:extension:log", 120, 60);
  if (limitResponse) return limitResponse;

  const authResult = await requireAuthenticatedUser();
  if (authResult.response) return authResult.response;
  const user = authResult.user;
  if (!user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

  const body = await request.json().catch(() => ({}));
  const level = normalizeLogLevel(body?.level);
  const message = normalizeMessage(body?.message);
  const action = normalizeMessage(body?.action) || "webview_log";

  if (!message) {
    return jsonError("Missing log message", 400, "BAD_REQUEST");
  }

  const context = {
    action,
    userId: user.id,
    message,
    route: "extension",
    sampleRate: level === "debug" || level === "info" ? 0.1 : 1,
  };
  if (level === "error") logger.error("[api/v1/extension/log] webview error", context);
  else if (level === "warn") logger.warn("[api/v1/extension/log] webview warning", context);
  else if (level === "debug") logger.debug("[api/v1/extension/log] webview debug", context);
  else logger.info("[api/v1/extension/log] webview info", context);

  recordExtensionMetric("extension.webview.log", {
    action,
    success: true,
    userId: user.id,
    count: 1,
  });

  return jsonSuccess({ logged: true });
}
