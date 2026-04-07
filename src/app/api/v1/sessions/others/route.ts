import { validateCsrf } from "@/lib/security/csrf";
import { resolvePasswordCredentialState } from "@/lib/auth/account-identity";
import {
  enforceRouteLimit,
  getSessionIdentifier,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { logger } from "@/lib/logger";
import { getProtectedRecoveryCodes } from "@/lib/services/profile-service";
import { getLatestPasswordChangeAt, recordSecurityEvent } from "@/lib/security/audit";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { countRemainingRecoveryCodes } from "@/lib/security/recovery-codes";
import { countOtherActiveSessions } from "@/lib/security/session-activity";
import { resolveSecurityStepUp, type SecurityStepUpMethod } from "@/lib/security/step-up";

export async function DELETE(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "sessions.deleteOthers",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:sessions:delete-others", 20, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "sessions.deleteOthers",
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
      action: "sessions.deleteOthers",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return auth.response;
  }
  const user = auth.user;
  if (!user) {
    logApiRoute(request, {
      requestId,
      action: "sessions.deleteOthers",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const factors = await listSecurityMfaFactors(auth.supabase);
    const hasVerifiedTotp = getVerifiedTotpFactors(factors).length > 0;
    const remainingRecoveryCodes = countRemainingRecoveryCodes(
      (await getProtectedRecoveryCodes(user.id, { authorized: true }))?.securityRecoveryCodes ?? [],
    );
    const availableMethods: SecurityStepUpMethod[] = [];
    if (hasVerifiedTotp) availableMethods.push("totp");
    if (remainingRecoveryCodes > 0) availableMethods.push("recovery_code");
    const passwordLastChangedAt = await getLatestPasswordChangeAt(user.id);
    if (resolvePasswordCredentialState(user, passwordLastChangedAt)) availableMethods.push("password");

    if (availableMethods.length > 0) {
      const stepUp = await resolveSecurityStepUp(user.id, availableMethods);
      if (!stepUp.ok) {
        logApiRoute(request, {
          requestId,
          action: "sessions.deleteOthers",
          userId: user.id,
          startedAt,
          success: false,
          status: 403,
          errorCode: "STEP_UP_REQUIRED",
        });
        return jsonError("Verify this device before logging out other devices", 403, "STEP_UP_REQUIRED");
      }
    }

    const {
      data: { session },
    } = await auth.supabase.auth.getSession();
    const currentSessionId = session ? getSessionIdentifier(session) ?? null : null;
    const revokedCount = await countOtherActiveSessions(user.id, currentSessionId);

    const result = await auth.supabase.auth.signOut({ scope: "others" });
    if (result.error) {
      logApiRoute(request, {
        requestId,
        action: "sessions.deleteOthers",
        userId: user.id,
        startedAt,
        success: false,
        status: 400,
        errorCode: "SESSION_REVOKE_FAILED",
      });
      return jsonError(result.error.message || "Failed to revoke other sessions", 400, "SESSION_REVOKE_FAILED");
    }

    await recordSecurityEvent({
      userId: user.id,
      eventType: "other_sessions_revoked",
      request,
      metadata: {
        revokedCount,
      },
    });

    logApiRoute(request, {
      requestId,
      action: "sessions.deleteOthers",
      userId: user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(undefined, "Other sessions revoked");
  } catch (error) {
    logger.error("[api/v1/sessions/others] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "sessions.deleteOthers",
      userId: user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to revoke other sessions", 500, "INTERNAL_ERROR");
  }
}
