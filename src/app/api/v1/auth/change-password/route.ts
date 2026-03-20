import { validateCsrf } from "@/lib/security/csrf";
import { resolvePasswordCredentialState } from "@/lib/auth/account-identity";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { getLatestPasswordChangeAt, recordSecurityEvent } from "@/lib/security/audit";
import { isEmailVerified } from "@/lib/auth/email-verification";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { verifyPasswordCredential } from "@/lib/security/password-auth";
import { resolveSecurityStepUp } from "@/lib/security/step-up";

type ChangePasswordBody = {
  currentPassword?: string;
  newPassword?: string;
};

function parseBody(payload: unknown): ChangePasswordBody {
  if (!payload || typeof payload !== "object") return {};
  return payload as ChangePasswordBody;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:change-password", 30, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
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
      action: "auth.changePassword.post",
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
      action: "auth.changePassword.post",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  let body: ChangePasswordBody = {};
  try {
    body = parseBody(await request.json());
  } catch {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Malformed JSON body", 400, "BAD_REQUEST");
  }

  const currentPassword = (body.currentPassword || "").trim();
  const newPassword = (body.newPassword || "").trim();
  if (!newPassword) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("A new password is required", 400, "BAD_REQUEST");
  }
  if (newPassword.length < 12) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("New password must be at least 12 characters", 400, "BAD_REQUEST");
  }
  if (newPassword === currentPassword) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("New password must be different from current password", 400, "BAD_REQUEST");
  }

  if (!auth.user.email || !isEmailVerified(auth.user)) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Account is missing a verified email address", 400, "BAD_REQUEST");
  }

  const passwordLastChangedAt = await getLatestPasswordChangeAt(auth.user.id);
  const accountHasPassword = resolvePasswordCredentialState(auth.user, passwordLastChangedAt);
  if (accountHasPassword && !currentPassword) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Current password is required", 400, "BAD_REQUEST");
  }

  try {
    const mfaFactors = await listSecurityMfaFactors(auth.supabase);
    const hasVerifiedTotp = getVerifiedTotpFactors(mfaFactors).length > 0;

    if (hasVerifiedTotp) {
      const stepUp = await resolveSecurityStepUp(auth.user.id, ["totp", "recovery_code"]);
      if (!stepUp.ok) {
        logApiRoute(request, {
          requestId,
          action: "auth.changePassword.post",
          userId: auth.user.id,
          startedAt,
          success: false,
          status: 403,
          errorCode: "STEP_UP_REQUIRED",
        });
        return jsonError(
          "Verify this device with your authenticator app or a recovery code before changing your password",
          403,
          "STEP_UP_REQUIRED",
        );
      }
    }

    if (accountHasPassword) {
      const verifyResult = await verifyPasswordCredential(auth.user.email, currentPassword);
      if (!verifyResult.ok) {
        logApiRoute(request, {
          requestId,
          action: "auth.changePassword.post",
          userId: auth.user.id,
          startedAt,
          success: false,
          status: 400,
          errorCode: "CURRENT_PASSWORD_INVALID",
        });
        return jsonError(verifyResult.message || "Current password is incorrect", 400, "CURRENT_PASSWORD_INVALID");
      }
    }

    const updateResult = await auth.supabase.auth.updateUser({ password: newPassword });
    if (updateResult.error) {
      logApiRoute(request, {
        requestId,
        action: "auth.changePassword.post",
        userId: auth.user.id,
        startedAt,
        success: false,
        status: 400,
        errorCode: "PASSWORD_CHANGE_FAILED",
      });
      return jsonError(updateResult.error.message || "Password update failed", 400, "PASSWORD_CHANGE_FAILED");
    }

    await recordSecurityEvent({
      userId: auth.user.id,
      eventType: accountHasPassword ? "password_changed" : "password_set",
      request,
      previousValue: { hasPassword: accountHasPassword },
      nextValue: { hasPassword: true },
      metadata: {
        hasAuthenticatorApp: hasVerifiedTotp,
      },
    });

    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(undefined, "Password updated successfully");
  } catch (error) {
    console.error("[api/v1/auth/change-password] failed", error);
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to change password", 500, "INTERNAL_ERROR");
  }
}
