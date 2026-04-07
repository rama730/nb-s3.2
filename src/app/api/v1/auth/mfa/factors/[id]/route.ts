import { validateCsrf } from "@/lib/security/csrf";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { recordSecurityEvent } from "@/lib/security/audit";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { countRemainingRecoveryCodes, parseStoredRecoveryCodes } from "@/lib/security/recovery-codes";
import { resolveSecurityStepUp } from "@/lib/security/step-up";
import { checkIdempotencyKey, saveIdempotencyResult } from "@/lib/security/idempotency";
import { logger } from "@/lib/logger";

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

  // Idempotency — prevent duplicate MFA factor deletions
  const idempotencyCheck = await checkIdempotencyKey(request, 'auth.mfa.deleteFactor');
  if (idempotencyCheck.isDuplicate) {
    if (idempotencyCheck.cachedResponse) {
      return new Response(idempotencyCheck.cachedResponse, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return jsonError('Request is already being processed', 409, 'CONFLICT');
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
  const user = auth.user;
  if (!user) {
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  const { id } = await context.params;

  try {
    const factors = await listSecurityMfaFactors(auth.supabase);
    const factorToRemove = factors.find((factor) => factor.id === id) ?? null;
    const verifiedTotpFactors = getVerifiedTotpFactors(factors);
    const isVerifiedTotp = factorToRemove?.type === "totp" && factorToRemove.status === "verified";

    if (isVerifiedTotp) {
      const stepUp = await resolveSecurityStepUp(user.id, ["totp", "recovery_code"]);
      if (!stepUp.ok) {
        logApiRoute(request, {
          requestId,
          action: "auth.mfaFactor.delete",
          userId: auth.user?.id ?? null,
          startedAt,
          success: false,
          status: 403,
          errorCode: "STEP_UP_REQUIRED",
        });
        return jsonError(
          "Verify this device with your authenticator app or a recovery code before removing an authenticator app",
          403,
          "STEP_UP_REQUIRED",
        );
      }
    }

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

    try {
      const removingLastVerifiedTotp = isVerifiedTotp && verifiedTotpFactors.length === 1;
      let clearedRecoveryCodes = false;
      let previousRemainingRecoveryCodes = 0;

      if (removingLastVerifiedTotp) {
        const existingProfile = await db.query.profiles.findFirst({
          columns: {
            securityRecoveryCodes: true,
          },
          where: eq(profiles.id, user.id),
        });
        const storedCodes = parseStoredRecoveryCodes(existingProfile?.securityRecoveryCodes);
        previousRemainingRecoveryCodes = countRemainingRecoveryCodes(storedCodes);
        clearedRecoveryCodes = storedCodes.length > 0;

        await db
          .update(profiles)
          .set({
            securityRecoveryCodes: [],
            recoveryCodesGeneratedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(profiles.id, user.id));
      }

      await recordSecurityEvent({
        userId: user.id,
        eventType: "authenticator_app_removed",
        request,
        metadata: {
          factorId: id,
          friendlyName: factorToRemove?.friendly_name ?? "Authenticator app",
          clearedRecoveryCodes,
          previousRemainingRecoveryCodes,
        },
      });
    } catch (cleanupError) {
      logger.error("auth.mfaFactor.delete.post_unenroll_cleanup_failed", {
        requestId,
        userId: user.id,
        factorId: id,
        error: cleanupError,
      });
    }

    logApiRoute(request, {
      requestId,
      action: "auth.mfaFactor.delete",
      userId: auth.user?.id ?? null,
      startedAt,
      success: true,
      status: 200,
    });
    const successBody = JSON.stringify({ ok: true, message: "MFA factor removed" });
    await saveIdempotencyResult(request, 'auth.mfa.deleteFactor', successBody, idempotencyCheck.lockToken);
    return jsonSuccess(undefined, "MFA factor removed");
  } catch (error) {
    logger.error("[api/v1/auth/mfa/factors/:id] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
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
