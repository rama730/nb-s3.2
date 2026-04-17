import { z } from "zod";
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
import { checkIdempotencyKey, saveIdempotencyResult } from "@/lib/security/idempotency";
import { getPasswordPolicyResult } from "@/lib/security/password-policy";
import { logger } from "@/lib/logger";

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(1),
});

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

  // H9: Tightened from 30/min to 10/hour for security-critical password changes
  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:change-password", 10, 3600);
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

  // Idempotency — prevent duplicate password changes
  const idempotencyCheck = await checkIdempotencyKey(request, 'auth.changePassword', auth.user.id);
  if (idempotencyCheck.isDuplicate) {
    if (idempotencyCheck.cachedResponse) {
      return new Response(idempotencyCheck.cachedResponse, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return jsonError('Request is already being processed', 409, 'CONFLICT');
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
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

  const parsed = changePasswordSchema.safeParse(rawBody);
  if (!parsed.success) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Invalid request body", 400, "BAD_REQUEST");
  }

  const currentPassword = (parsed.data.currentPassword || "").trim();
  const newPassword = parsed.data.newPassword.trim();
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
  const passwordPolicy = getPasswordPolicyResult(newPassword);
  if (!passwordPolicy.ok) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError(passwordPolicy.error || "New password does not meet security requirements", 400, "BAD_REQUEST");
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

    if (!accountHasPassword) {
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
          "Set up MFA and verify this device before setting a password on this account",
          403,
          "STEP_UP_REQUIRED",
        );
      }
    }

    if (accountHasPassword) {
      const verifyResult = await verifyPasswordCredential(auth.user.email, currentPassword);
      if (!verifyResult.ok) {
        const invalidCredentials = verifyResult.reason === "invalid_credentials";
        const emailNotConfirmed = verifyResult.reason === "email_not_confirmed";
        logApiRoute(request, {
          requestId,
          action: "auth.changePassword.post",
          userId: auth.user.id,
          startedAt,
          success: false,
          status: invalidCredentials ? 400 : emailNotConfirmed ? 403 : 500,
          errorCode: invalidCredentials
            ? "CURRENT_PASSWORD_INVALID"
            : emailNotConfirmed
              ? "EMAIL_NOT_CONFIRMED"
              : "INTERNAL_ERROR",
        });
        return jsonError(
          verifyResult.message || (
            invalidCredentials
              ? "Current password is incorrect"
              : emailNotConfirmed
                ? "Confirm your email address before changing your password"
                : "Unable to verify password"
          ),
          invalidCredentials ? 400 : emailNotConfirmed ? 403 : 500,
          invalidCredentials ? "CURRENT_PASSWORD_INVALID" : emailNotConfirmed ? "EMAIL_NOT_CONFIRMED" : "INTERNAL_ERROR",
        );
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
      return jsonError("Password update failed", 400, "PASSWORD_CHANGE_FAILED");
    }

    try {
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
    } catch (auditError) {
      logger.error("auth.change_password.audit_failed", {
        requestId,
        userId: auth.user.id,
        eventType: accountHasPassword ? "password_changed" : "password_set",
        error: auditError,
      });
    }

    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    const successBody = JSON.stringify({ ok: true, message: "Password updated successfully" });
    await saveIdempotencyResult(request, 'auth.changePassword', successBody, idempotencyCheck.lockToken, auth.user.id);
    return jsonSuccess(undefined, "Password updated successfully");
  } catch (error) {
    logger.error("[api/v1/auth/change-password] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
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
