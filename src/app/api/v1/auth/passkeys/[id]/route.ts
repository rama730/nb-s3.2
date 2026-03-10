import { validateCsrf } from "@/lib/security/csrf";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "auth.passkeys.delete",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:passkeys:delete", 40, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.passkeys.delete",
      startedAt,
      success: false,
      status: 429,
      errorCode: "RATE_LIMITED",
    });
    return limitResponse;
  }

  const auth = await requireAuthenticatedUser();
  if (auth.response) {
    logApiRoute(request, {
      requestId,
      action: "auth.passkeys.delete",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return auth.response;
  }

  const { id } = await context.params;

  try {
    const mfaApi = (auth.supabase.auth as any)?.mfa;
    if (!mfaApi?.unenroll) {
      logApiRoute(request, {
        requestId,
        action: "auth.passkeys.delete",
        userId: auth.user?.id ?? null,
        startedAt,
        success: false,
        status: 501,
        errorCode: "NOT_SUPPORTED",
      });
      return jsonError("Passkeys are not available for this project", 501, "NOT_SUPPORTED");
    }

    // Supabase versions may differ between `unenroll(factorId)` and `unenroll({ factorId })`.
    let result = await mfaApi.unenroll(id);
    if (result?.error && typeof result?.error?.message === "string" && /argument|factor/i.test(result.error.message)) {
      result = await mfaApi.unenroll({ factorId: id });
    }

    if (result?.error) {
      logApiRoute(request, {
        requestId,
        action: "auth.passkeys.delete",
        userId: auth.user?.id ?? null,
        startedAt,
        success: false,
        status: 400,
        errorCode: "BAD_REQUEST",
      });
      return jsonError(result.error.message || "Failed to remove passkey", 400, "BAD_REQUEST");
    }

    logApiRoute(request, {
      requestId,
      action: "auth.passkeys.delete",
      userId: auth.user?.id ?? null,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(undefined, "Passkey removed");
  } catch (error) {
    console.error("[api/v1/auth/passkeys/:id] failed", error);
    logApiRoute(request, {
      requestId,
      action: "auth.passkeys.delete",
      userId: auth.user?.id ?? null,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to remove passkey", 500, "INTERNAL_ERROR");
  }
}
