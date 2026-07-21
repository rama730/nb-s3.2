import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { logger } from "@/lib/logger";
import { isProfileNotFoundError, updatePrivacySetting } from "@/lib/privacy/settings";
import { validateCsrf } from "@/lib/security/csrf";

type PrivacyUpdate = Parameters<typeof updatePrivacySetting>[0];

export async function handlePrivacySettingPatch<T extends string>(request: Request, config: {
  kind: PrivacyUpdate["kind"];
  bodyKey: string;
  responseKey: string;
  values: readonly T[];
  invalidMessage: string;
  failureMessage: string;
}) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  const action = `privacy.${config.kind}.patch`;
  const limitResponse = await enforceRouteLimit(request, `api:v1:${action}`, 60, 60);
  if (limitResponse) return limitResponse;
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");

  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const value = typeof body?.[config.bodyKey] === "string" ? body[config.bodyKey] as T : null;
    if (!value || !config.values.includes(value)) return jsonError(config.invalidMessage, 400, "BAD_REQUEST");
    await updatePrivacySetting({ userId: auth.user.id, request, kind: config.kind, nextValue: value } as PrivacyUpdate);
    logApiRoute(request, { requestId, action, userId: auth.user.id, startedAt, success: true, status: 200 });
    return jsonSuccess({ [config.responseKey]: value });
  } catch (error) {
    logger.error(`[api/v1/privacy/${config.kind}] failed`, { module: "api", requestId, error: error instanceof Error ? error.message : String(error) });
    if (isProfileNotFoundError(error)) return jsonError("Profile not found", 404, "NOT_FOUND");
    return jsonError(config.failureMessage, 500, "INTERNAL_ERROR");
  }
}
