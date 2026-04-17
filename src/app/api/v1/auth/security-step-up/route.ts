import { eq, sql } from "drizzle-orm";
import { validateCsrf } from "@/lib/security/csrf";
import { resolvePasswordCredentialState } from "@/lib/auth/account-identity";
import { db } from "@/lib/db";
import { profileSecurityStates, recoveryCodeRedemptions } from "@/lib/db/schema";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { logger } from "@/lib/logger";
import { getProtectedRecoveryCodes } from "@/lib/services/profile-service";
import { issueSecurityStepUpCookie, type SecurityStepUpMethod } from "@/lib/security/step-up";
import {
  consumeRecoveryCode,
  countRemainingRecoveryCodes,
  parseStoredRecoveryCodes,
} from "@/lib/security/recovery-codes";
import { getLatestPasswordChangeAt, recordSecurityEvent } from "@/lib/security/audit";
import { verifyPasswordCredential } from "@/lib/security/password-auth";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";

type SecurityStepUpBody = {
  method?: SecurityStepUpMethod;
  factorId?: string;
  code?: string;
  password?: string;
};

function parseBody(payload: unknown): SecurityStepUpBody {
  if (!payload || typeof payload !== "object") return {};
  return payload as SecurityStepUpBody;
}

async function resolveStepUpCapabilities(input: {
  supabase: Awaited<ReturnType<typeof requireAuthenticatedUser>>["supabase"];
  user: NonNullable<Awaited<ReturnType<typeof requireAuthenticatedUser>>["user"]>;
}) {
  const factors = await listSecurityMfaFactors(input.supabase);
  const verifiedTotpFactor = getVerifiedTotpFactors(factors)[0];
  const remainingRecoveryCodes = countRemainingRecoveryCodes(
    (await getProtectedRecoveryCodes(input.user.id, { authorized: true }))?.securityRecoveryCodes ?? [],
  );
  const passwordLastChangedAt = await getLatestPasswordChangeAt(input.user.id);
  const availableMethods: SecurityStepUpMethod[] = [];
  if (verifiedTotpFactor?.id) availableMethods.push("totp");
  if (remainingRecoveryCodes > 0) availableMethods.push("recovery_code");
  if (input.user.email && resolvePasswordCredentialState(input.user, passwordLastChangedAt)) {
    availableMethods.push("password");
  }

  return {
    availableMethods,
    primaryTotpFactorId: verifiedTotpFactor?.id,
  };
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:security-step-up:get", 60, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.securityStepUp.get",
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
      action: "auth.securityStepUp.get",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return auth.response;
  }

  if (!auth.user) {
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const payload = await resolveStepUpCapabilities({
      supabase: auth.supabase,
      user: auth.user,
    });

    logApiRoute(request, {
      requestId,
      action: "auth.securityStepUp.get",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(payload);
  } catch (error) {
    logger.error("[api/v1/auth/security-step-up] capability lookup failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "auth.securityStepUp.get",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to load security verification options", 500, "INTERNAL_ERROR");
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "auth.securityStepUp.post",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:security-step-up", 30, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.securityStepUp.post",
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
      action: "auth.securityStepUp.post",
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

  let body: SecurityStepUpBody = {};
  try {
    body = parseBody(await request.json());
  } catch {
    logApiRoute(request, {
      requestId,
      action: "auth.securityStepUp.post",
      userId: user.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Malformed JSON body", 400, "BAD_REQUEST");
  }

  const method = body.method;
  if (method !== "totp" && method !== "recovery_code" && method !== "password") {
    logApiRoute(request, {
      requestId,
      action: "auth.securityStepUp.post",
      userId: user.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    logger.info("auth.step_up.invalid_method", {
      requestId,
      userId: user.id,
      method: typeof method === "string" ? method : null,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("A valid verification method is required", 400, "BAD_REQUEST");
  }

  try {
    const logAndJsonError = (
      message: string,
      status: number,
      errorCode: "BAD_REQUEST" | "STEP_UP_INVALID" | "RECOVERY_CODE_INVALID" | "INTERNAL_ERROR" | "EMAIL_NOT_CONFIRMED",
      failureReason: string,
    ) => {
      logApiRoute(request, {
        requestId,
        action: "auth.securityStepUp.post",
        userId: user.id,
        startedAt,
        success: false,
        status,
        errorCode,
      });
      logger.info("auth.securityStepUp.failure", {
        requestId,
        userId: user.id,
        method,
        failureReason,
        status,
        errorCode,
      });
      return jsonError(message, status, errorCode);
    };

    if (method === "totp") {
      const factorId = typeof body.factorId === "string" ? body.factorId.trim() : "";
      const code = typeof body.code === "string" ? body.code.trim() : "";
      // M13: Validate factor ID format (UUID)
      if (!factorId || !/^[a-f0-9-]{36}$/.test(factorId) || !/^[0-9]{6}$/.test(code)) {
        return jsonError("Enter the current 6-digit code from your authenticator app", 400, "BAD_REQUEST");
      }

      const result = await (auth.supabase.auth as any).mfa.challengeAndVerify({
        factorId,
        code,
      });
      if (result?.error) {
        return logAndJsonError(
          result.error.message || "That code did not match. Use the current 6-digit code from your authenticator app.",
          400,
          "STEP_UP_INVALID",
          "TOTP_MISMATCH",
        );
      }
    }

    if (method === "recovery_code") {
      const rawCode = typeof body.code === "string" ? body.code : "";

      // SEC-H3: before redeeming, confirm the codes are still bound to a
      // TOTP factor that is currently verified for this user. When a user
      // rotates their authenticator the old factor disappears and we must
      // reject any surviving recovery codes rather than grant step-up.
      const currentFactors = await listSecurityMfaFactors(auth.supabase);
      const verifiedTotpFactorIds = new Set(
        getVerifiedTotpFactors(currentFactors).map((factor) => factor.id),
      );

      const recoveryResult = await db.transaction(async (tx) => {
        const rows = await tx.execute<{
          security_recovery_codes: unknown;
          recovery_codes_factor_id: string | null;
        }>(sql`
          SELECT security_recovery_codes, recovery_codes_factor_id
          FROM profile_security_states
          WHERE user_id = ${user.id}::uuid
          FOR UPDATE
        `);

        const storedCodes = parseStoredRecoveryCodes(rows[0]?.security_recovery_codes);
        if (storedCodes.length === 0) {
          return { matched: false, remainingCount: 0, factorInvalidated: false };
        }

        const storedFactorId = rows[0]?.recovery_codes_factor_id ?? null;
        // Reject when:
        //   a) codes were bound to a factor that is no longer verified, or
        //   b) codes were never bound (pre-SEC-H3) AND the user currently
        //      has no verified TOTP factor — users are expected to regen.
        const factorStillVerified = storedFactorId
          ? verifiedTotpFactorIds.has(storedFactorId)
          : verifiedTotpFactorIds.size > 0;
        if (!factorStillVerified) {
          return { matched: false, remainingCount: storedCodes.length, factorInvalidated: true };
        }

        const consumed = consumeRecoveryCode(storedCodes, rawCode);
        if (!consumed.matched) {
          return {
            matched: false,
            remainingCount: countRemainingRecoveryCodes(storedCodes),
            factorInvalidated: false,
          };
        }

        const redemption = await tx
          .insert(recoveryCodeRedemptions)
          .values({
            userId: user.id,
            codeId: consumed.matchedCodeId!,
          })
          .onConflictDoNothing()
          .returning({ id: recoveryCodeRedemptions.id });

        if (redemption.length === 0) {
          return {
            matched: false,
            remainingCount: countRemainingRecoveryCodes(storedCodes),
            factorInvalidated: false,
          };
        }

        await tx
          .insert(profileSecurityStates)
          .values({
            userId: user.id,
            securityRecoveryCodes: consumed.updatedCodes,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: profileSecurityStates.userId,
            set: {
              securityRecoveryCodes: consumed.updatedCodes,
              updatedAt: new Date(),
            },
          });

        return {
          matched: true,
          remainingCount: consumed.remainingCount,
          factorInvalidated: false,
        };
      });

      if (!recoveryResult.matched) {
        // SEC-L7: persist a redemption-attempt record (without the submitted
        // code or any derivative) so the legitimate account owner can see
        // that someone tried to use their recovery codes. Non-blocking —
        // failure to audit must not mask the underlying rejection.
        try {
          await recordSecurityEvent({
            userId: user.id,
            eventType: "recovery_code_redemption_failed",
            request,
            metadata: {
              failureReason: recoveryResult.factorInvalidated
                ? "factor_invalidated"
                : "code_mismatch",
              remainingCount: recoveryResult.remainingCount,
            },
          });
        } catch (auditError) {
          logger.error("auth.step_up.audit_failed", {
            requestId,
            userId: user.id,
            eventType: "recovery_code_redemption_failed",
            error: auditError instanceof Error ? auditError.message : String(auditError),
          });
        }

        if (recoveryResult.factorInvalidated) {
          return logAndJsonError(
            "These recovery codes are no longer valid because your authenticator app was changed. Generate a new set from the Security tab.",
            400,
            "RECOVERY_CODE_INVALID",
            "RECOVERY_CODE_FACTOR_INVALIDATED",
          );
        }
        return logAndJsonError(
          "That recovery code did not match. Check the code and try again.",
          400,
          "RECOVERY_CODE_INVALID",
          "RECOVERY_CODE_INVALID",
        );
      }

      // M16: Non-blocking audit — failure should not abort the step-up operation
      try {
        await recordSecurityEvent({
          userId: user.id,
          eventType: "recovery_code_used",
          request,
          metadata: {
            remainingCount: recoveryResult.remainingCount,
          },
        });
      } catch (auditError) {
        logger.error("auth.step_up.audit_failed", {
          requestId,
          userId: user.id,
          eventType: "recovery_code_used",
          error: auditError instanceof Error ? auditError.message : String(auditError),
        });
      }
    }

    if (method === "password") {
      const password = typeof body.password === "string" ? body.password : "";
      if (!password.trim()) {
        return jsonError("Enter your current password", 400, "BAD_REQUEST");
      }
      const passwordLastChangedAt = await getLatestPasswordChangeAt(user.id);
      if (!user.email || !resolvePasswordCredentialState(user, passwordLastChangedAt)) {
        return jsonError("Password verification is not available for this account", 400, "BAD_REQUEST");
      }

      const verification = await verifyPasswordCredential(user.email, password);
      if (!verification.ok) {
        const invalidCredentials = verification.reason === "invalid_credentials";
        const emailNotConfirmed = verification.reason === "email_not_confirmed";
        return logAndJsonError(
          verification.message || (
            invalidCredentials
              ? "Current password is incorrect"
              : emailNotConfirmed
                ? "Confirm your email address before verifying your password"
                : "Unable to verify password"
          ),
          invalidCredentials ? 400 : emailNotConfirmed ? 403 : 500,
          invalidCredentials ? "STEP_UP_INVALID" : emailNotConfirmed ? "EMAIL_NOT_CONFIRMED" : "INTERNAL_ERROR",
          invalidCredentials ? "PASSWORD_INCORRECT" : emailNotConfirmed ? "PASSWORD_EMAIL_NOT_CONFIRMED" : "PASSWORD_VERIFICATION_FAILED",
        );
      }
    }

    const response = jsonSuccess(
      {
        method,
      },
      "Security verification complete",
    );
    const validity = issueSecurityStepUpCookie(response, user.id, method);
    response.headers.set("content-type", "application/json");
    response.headers.set(
      "x-step-up-expires-at",
      validity.expiresAt,
    );

    logApiRoute(request, {
      requestId,
      action: "auth.securityStepUp.post",
      userId: user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return response;
  } catch (error) {
    logger.error("[api/v1/auth/security-step-up] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "auth.securityStepUp.post",
      userId: user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to verify this device", 500, "INTERNAL_ERROR");
  }
}
