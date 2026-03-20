import {
  enforceRouteLimit,
  getSessionIdentifier,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { eq } from "drizzle-orm";
import { resolvePasswordCredentialState } from "@/lib/auth/account-identity";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { isSecurityHardeningEnabled } from "@/lib/features/security";
import { getLatestPasswordChangeAt, listSecurityActivity } from "@/lib/security/audit";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { countRemainingRecoveryCodes, parseStoredRecoveryCodes } from "@/lib/security/recovery-codes";
import { listActiveSessions, listLoginHistory } from "@/lib/security/session-activity";

type SecurityPayload = {
  mfaFactors: Array<{
    id: string;
    type: "totp" | "phone";
    friendly_name?: string;
    created_at?: string;
    status: "verified" | "unverified";
  }>;
  sessions: Array<{
    id: string;
    device_info: { userAgent: string };
    ip_address: string;
    last_active: string;
    created_at?: string;
    aal?: "aal1" | "aal2" | null;
    is_current?: boolean;
  }>;
  loginHistory: Array<{
    id: string;
    ip_address: string;
    user_agent: string;
    created_at: string;
    location?: string;
    aal?: "aal1" | "aal2" | null;
  }>;
  password: {
    hasPassword: boolean;
    lastChangedAt?: string;
  };
  recoveryCodes: {
    configured: boolean;
    remainingCount: number;
    generatedAt?: string;
  };
  securityActivity: Array<{
    id: string;
    eventType:
      | "authenticator_app_enabled"
      | "authenticator_app_removed"
      | "recovery_codes_generated"
      | "recovery_codes_regenerated"
      | "recovery_code_used"
      | "password_set"
      | "password_changed"
      | "other_sessions_revoked";
    createdAt: string;
    ipAddress?: string;
    userAgent?: string;
    metadata: Record<string, unknown>;
  }>;
  assurance: {
    currentLevel: "aal1" | "aal2" | null;
    nextLevel: "aal1" | "aal2" | null;
  };
};

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
    const passwordLastChangedAt = await getLatestPasswordChangeAt(auth.user.id);
    const payload: SecurityPayload = {
      mfaFactors: [],
      sessions: [],
      loginHistory: [],
      password: {
        hasPassword: resolvePasswordCredentialState(auth.user, passwordLastChangedAt),
      },
      recoveryCodes: {
        configured: false,
        remainingCount: 0,
      },
      securityActivity: [],
      assurance: {
        currentLevel: null,
        nextLevel: null,
      },
    };

    payload.mfaFactors = await listSecurityMfaFactors(auth.supabase);
    const verifiedTotpFactors = getVerifiedTotpFactors(payload.mfaFactors);

    const {
      data: { session },
    } = await auth.supabase.auth.getSession();
    const currentSessionId =
      session ? getSessionIdentifier(session) ?? null : null;
    payload.sessions = await listActiveSessions(
      auth.user.id,
      currentSessionId,
      securityHardeningEnabled ? 12 : 8,
    );
    payload.loginHistory = await listLoginHistory(auth.user.id, securityHardeningEnabled ? 20 : 10);
    payload.password.lastChangedAt = passwordLastChangedAt ?? undefined;
    payload.securityActivity = await listSecurityActivity(auth.user.id, securityHardeningEnabled ? 20 : 12);

    const profile = await db.query.profiles.findFirst({
      columns: {
        securityRecoveryCodes: true,
        recoveryCodesGeneratedAt: true,
      },
      where: eq(profiles.id, auth.user.id),
    });
    const storedRecoveryCodes = parseStoredRecoveryCodes(profile?.securityRecoveryCodes);
    payload.recoveryCodes = {
      configured: storedRecoveryCodes.length > 0 || !!profile?.recoveryCodesGeneratedAt,
      remainingCount: countRemainingRecoveryCodes(storedRecoveryCodes),
      ...(profile?.recoveryCodesGeneratedAt
        ? { generatedAt: profile.recoveryCodesGeneratedAt.toISOString() }
        : {}),
    };

    const mfaApi = (auth.supabase.auth as any)?.mfa;
    if (mfaApi?.getAuthenticatorAssuranceLevel) {
      const assuranceResult = await mfaApi.getAuthenticatorAssuranceLevel();
      if (assuranceResult?.data) {
        payload.assurance = {
          currentLevel:
            assuranceResult.data.currentLevel === "aal2" ? "aal2" : assuranceResult.data.currentLevel === "aal1" ? "aal1" : null,
          nextLevel:
            assuranceResult.data.nextLevel === "aal2" ? "aal2" : assuranceResult.data.nextLevel === "aal1" ? "aal1" : null,
        };
      }
    }

    if (verifiedTotpFactors.length === 0 && payload.recoveryCodes.configured) {
      payload.recoveryCodes = {
        configured: false,
        remainingCount: 0,
      };
    }

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
    console.error("[api/v1/security] failed", error);
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
