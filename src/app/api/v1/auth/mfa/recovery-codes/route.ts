import { and, eq, sql } from "drizzle-orm";
import { validateCsrf } from "@/lib/security/csrf";
import { db } from "@/lib/db";
import { profileAuditEvents, profiles } from "@/lib/db/schema";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { checkIdempotencyKey, saveIdempotencyResult } from "@/lib/security/idempotency";
import { logger } from "@/lib/logger";
import { recordSecurityEvent } from "@/lib/security/audit";
import {
  countRemainingRecoveryCodes,
  generateRecoveryCodes,
  parseStoredRecoveryCodes,
} from "@/lib/security/recovery-codes";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { resolveSecurityStepUp } from "@/lib/security/step-up";

type RecoveryCodeMode = "initial" | "regenerate";

type RecoveryCodeBody = {
  mode?: string;
};

function parseBody(payload: unknown): RecoveryCodeBody {
  if (!payload || typeof payload !== "object") return {};
  return payload as RecoveryCodeBody;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "auth.mfaRecoveryCodes.post",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:mfa:recovery-codes", 20, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.mfaRecoveryCodes.post",
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
      action: "auth.mfaRecoveryCodes.post",
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

  // Idempotency — prevent duplicate recovery code generation
  const idempotencyCheck = await checkIdempotencyKey(request, 'auth.mfa.recoveryCodes');
  if (idempotencyCheck.isDuplicate) {
    if (idempotencyCheck.cachedResponse) {
      logApiRoute(request, {
        requestId,
        action: "auth.mfaRecoveryCodes.post",
        startedAt,
        success: true,
        status: 200,
        userId: user.id,
      });
      return new Response(idempotencyCheck.cachedResponse, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return jsonError('Request is already being processed', 409, 'CONFLICT');
  }

  let body: RecoveryCodeBody = {};
  try {
    body = parseBody(await request.json());
  } catch {
    return jsonError("Malformed JSON body", 400, "BAD_REQUEST");
  }

  const mode = body.mode;
  if (mode !== "initial" && mode !== "regenerate") {
    return jsonError("A valid recovery-code mode is required", 400, "BAD_REQUEST");
  }

  try {
    const factors = await listSecurityMfaFactors(auth.supabase);
    const verifiedTotpFactors = getVerifiedTotpFactors(factors);
    if (verifiedTotpFactors.length === 0) {
      return jsonError("Set up an authenticator app before managing recovery codes", 400, "BAD_REQUEST");
    }

    if (mode === "regenerate") {
      const stepUp = await resolveSecurityStepUp(user.id, ["totp", "recovery_code"]);
      if (!stepUp.ok) {
        return jsonError(
          "Verify this device with your authenticator app or a recovery code before regenerating recovery codes",
          403,
          "STEP_UP_REQUIRED",
        );
      }
    }

    const generated = generateRecoveryCodes();
    const result = await db.transaction(async (tx) => {
      const rows = await tx.execute<{
        security_recovery_codes: unknown;
        recovery_codes_generated_at: Date | string | null;
      }>(sql`
        SELECT security_recovery_codes, recovery_codes_generated_at
        FROM profiles
        WHERE id = ${user.id}::uuid
        FOR UPDATE
      `);

      const existingCodes = parseStoredRecoveryCodes(rows[0]?.security_recovery_codes);
      const existingGeneratedAt = rows[0]?.recovery_codes_generated_at
        ? new Date(rows[0].recovery_codes_generated_at).toISOString()
        : null;

      if (mode === "initial" && (existingCodes.length > 0 || existingGeneratedAt)) {
        return {
          conflict: true,
          previousRemainingCount: countRemainingRecoveryCodes(existingCodes),
          previousGeneratedAt: existingGeneratedAt,
        };
      }

      await tx
        .update(profiles)
        .set({
          securityRecoveryCodes: generated.storedCodes,
          recoveryCodesGeneratedAt: new Date(generated.generatedAt),
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, user.id));

      await recordSecurityEvent({
        userId: user.id,
        eventType: mode === "initial" ? "recovery_codes_generated" : "recovery_codes_regenerated",
        request,
        metadata: {
          remainingCount: generated.codes.length,
          previousRemainingCount: countRemainingRecoveryCodes(existingCodes),
          ...(existingGeneratedAt ? { previousGeneratedAt: existingGeneratedAt } : {}),
        },
        executor: tx,
      });

      if (mode === "initial") {
        const [existingEnableEvent] = await tx
          .select({
            id: profileAuditEvents.id,
          })
          .from(profileAuditEvents)
          .where(
            and(
              eq(profileAuditEvents.userId, user.id),
              eq(profileAuditEvents.eventType, "authenticator_app_enabled"),
            ),
          )
          .limit(1);

        if (!existingEnableEvent) {
          await recordSecurityEvent({
            userId: user.id,
            eventType: "authenticator_app_enabled",
            request,
            metadata: {
              factorCount: verifiedTotpFactors.length,
            },
            executor: tx,
          });
        }
      }

      return {
        conflict: false,
        previousRemainingCount: countRemainingRecoveryCodes(existingCodes),
        previousGeneratedAt: existingGeneratedAt,
      };
    });

    if (result.conflict) {
      return jsonError(
        "Recovery codes were already generated. Regenerate them from the Security tab instead.",
        409,
        "CONFLICT",
      );
    }

    logApiRoute(request, {
      requestId,
      action: "auth.mfaRecoveryCodes.post",
      userId: user.id,
      startedAt,
      success: true,
      status: 200,
    });
    const responseData = {
      codes: generated.codes,
      configured: true,
      remainingCount: generated.codes.length,
      generatedAt: generated.generatedAt,
    };
    const successBody = JSON.stringify({ ok: true, data: responseData });
    try {
      await saveIdempotencyResult(request, 'auth.mfa.recoveryCodes', successBody, idempotencyCheck.lockToken);
    } catch (saveError) {
      logger.error("[api/v1/auth/mfa/recovery-codes] failed to save idempotency result", {
        module: "api",
        requestId,
        userId: user.id,
        error: saveError instanceof Error ? saveError.message : String(saveError),
        stack: saveError instanceof Error ? saveError.stack : undefined,
      });
    }
    return jsonSuccess(responseData);
  } catch (error) {
    logger.error("[api/v1/auth/mfa/recovery-codes] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "auth.mfaRecoveryCodes.post",
      userId: user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to manage recovery codes", 500, "INTERNAL_ERROR");
  }
}
