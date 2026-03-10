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
      action: "auth.mfaFactor.delete",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:mfa:factors:delete", 40, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.mfaFactor.delete",
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
      action: "auth.mfaFactor.delete",
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
        action: "auth.mfaFactor.delete",
        userId: auth.user?.id ?? null,
        startedAt,
        success: false,
        status: 501,
        errorCode: "NOT_SUPPORTED",
      });
      return jsonError("MFA factors are not available for this project", 501, "NOT_SUPPORTED");
    }

    let result = await mfaApi.unenroll(id);
    if (result?.error && typeof result?.error?.message === "string" && /argument|factor/i.test(result.error.message)) {
      result = await mfaApi.unenroll({ factorId: id });
    }

    if (result?.error) {
      const message = result.error.message || "Failed to remove MFA factor";
      const rawStatus = Number((result.error as { status?: unknown })?.status);
      const status = Number.isFinite(rawStatus) ? rawStatus : undefined;
      const rawCode = String((result.error as { code?: unknown; type?: unknown })?.code ?? (result.error as { type?: unknown })?.type ?? "").toLowerCase();

      if (status === 404 || rawCode.includes("not_found")) {
        logApiRoute(request, {
          requestId,
          action: "auth.mfaFactor.delete",
          userId: auth.user?.id ?? null,
          startedAt,
          success: false,
          status: 404,
          errorCode: "NOT_FOUND",
        });
        return jsonError(message, 404, "NOT_FOUND");
      }
      if (status === 401) {
        logApiRoute(request, {
          requestId,
          action: "auth.mfaFactor.delete",
          userId: auth.user?.id ?? null,
          startedAt,
          success: false,
          status: 401,
          errorCode: "UNAUTHORIZED",
        });
        return jsonError(message, 401, "UNAUTHORIZED");
      }
      if (status === 403) {
        logApiRoute(request, {
          requestId,
          action: "auth.mfaFactor.delete",
          userId: auth.user?.id ?? null,
          startedAt,
          success: false,
          status: 403,
          errorCode: "FORBIDDEN",
        });
        return jsonError(message, 403, "FORBIDDEN");
      }
      if (status && status >= 400 && status < 500) {
        logApiRoute(request, {
          requestId,
          action: "auth.mfaFactor.delete",
          userId: auth.user?.id ?? null,
          startedAt,
          success: false,
          status,
          errorCode: "BAD_REQUEST",
        });
        return jsonError(message, status, "BAD_REQUEST");
      }
      logApiRoute(request, {
        requestId,
        action: "auth.mfaFactor.delete",
        userId: auth.user?.id ?? null,
        startedAt,
        success: false,
        status: 500,
        errorCode: "INTERNAL_ERROR",
      });
      return jsonError(message, 500, "INTERNAL_ERROR");
    }

    logApiRoute(request, {
      requestId,
      action: "auth.mfaFactor.delete",
      userId: auth.user?.id ?? null,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(undefined, "MFA factor removed");
  } catch (error) {
    console.error("[api/v1/auth/mfa/factors/:id] failed", error);
    logApiRoute(request, {
      requestId,
      action: "auth.mfaFactor.delete",
      userId: auth.user?.id ?? null,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to remove MFA factor", 500, "INTERNAL_ERROR");
  }
}
