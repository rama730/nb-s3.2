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
import { resolvePasswordCredentialState } from "@/lib/auth/account-identity";
import { isSecurityHardeningEnabled } from "@/lib/features/security";
import { getProtectedRecoveryCodes } from "@/lib/services/profile-service";
import { getLatestPasswordChangeAt, listSecurityActivity } from "@/lib/security/audit";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { countRemainingRecoveryCodes } from "@/lib/security/recovery-codes";
import { listActiveSessions, listLoginHistory } from "@/lib/security/session-activity";
import type { SecurityData } from "@/lib/types/settingsTypes";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:security:get", 120, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "security.get",
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
      action: "security.get",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return auth.response;
  }
  if (!auth.user) {
    logApiRoute(request, {
      requestId,
      action: "security.get",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const securityHardeningEnabled = isSecurityHardeningEnabled(auth.user.id);
    const [
      passwordLastChangedAt,
      mfaFactors,
      sessionResult,
      loginHistory,
      securityActivity,
      recoveryCodesState,
      assuranceResult,
    ] = await Promise.all([
      getLatestPasswordChangeAt(auth.user.id),
      listSecurityMfaFactors(auth.supabase),
      auth.supabase.auth.getSession(),
      listLoginHistory(auth.user.id, securityHardeningEnabled ? 20 : 10),
      listSecurityActivity(auth.user.id, securityHardeningEnabled ? 20 : 12),
      getProtectedRecoveryCodes(auth.user.id, { authorized: true }),
      ((auth.supabase.auth as any)?.mfa?.getAuthenticatorAssuranceLevel?.() ?? Promise.resolve(null)),
    ]);

    const verifiedTotpFactors = getVerifiedTotpFactors(mfaFactors);

    const session = sessionResult.data?.session;
    const currentSessionId =
      session ? getSessionIdentifier(session) ?? null : null;
    const sessions = await listActiveSessions(
      auth.user.id,
      currentSessionId,
      securityHardeningEnabled ? 12 : 8,
    );
    const storedRecoveryCodes = recoveryCodesState?.securityRecoveryCodes ?? [];
    const recoveryCodes = verifiedTotpFactors.length === 0 ? {
      configured: false,
      remainingCount: 0,
    } : {
      configured: recoveryCodesState?.hasRecoveryCodes ?? false,
      remainingCount: countRemainingRecoveryCodes(storedRecoveryCodes),
      ...(recoveryCodesState?.recoveryCodesGeneratedAt
        ? { generatedAt: recoveryCodesState.recoveryCodesGeneratedAt.toISOString() }
        : {}),
    };
    const normalizeAssurance = (level: unknown): "aal1" | "aal2" | null => level === "aal1" || level === "aal2" ? level : null;
    const payload: SecurityData = {
      mfaFactors,
      sessions,
      loginHistory,
      password: {
        hasPassword: resolvePasswordCredentialState(auth.user, passwordLastChangedAt),
        ...(passwordLastChangedAt ? { lastChangedAt: passwordLastChangedAt } : {}),
      },
      recoveryCodes,
      securityActivity,
      assurance: {
        currentLevel: normalizeAssurance(assuranceResult?.data?.currentLevel),
        nextLevel: normalizeAssurance(assuranceResult?.data?.nextLevel),
      },
    };

    logApiRoute(request, {
      requestId,
      action: "security.get",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(payload);
  } catch (error) {
    logger.error("[api/v1/security] failed", {
      module: 'api',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logApiRoute(request, {
      requestId,
      action: "security.get",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to load security data", 500, "INTERNAL_ERROR");
  }
}
