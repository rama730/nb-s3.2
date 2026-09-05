import { validateCsrf } from "@/lib/security/csrf";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import {
  clearGithubAccountHealthCache,
  resolveGithubExternalAccountHealth,
} from "@/lib/github/account-health";
import { buildGithubAccountConnectionState } from "@/lib/github/connection-state";
import { clearGithubImportAccessCookie } from "@/lib/github/import-access-cookie";
import { logger } from "@/lib/logger";
import { recordSecurityEvent } from "@/lib/security/audit";
import { resolveSecurityStepUp } from "@/lib/security/step-up";

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const action = "github.account.replace";
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  const limitResponse = await enforceRouteLimit(
    request,
    "api:v1:github:account:replacement",
    5,
    60 * 60,
  );
  if (limitResponse) return limitResponse;

  const auth = await requireAuthenticatedUser();
  if (auth.response) return auth.response;
  const user = auth.user;
  if (!user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  if (auth.extensionSessionId) {
    return jsonError(
      "Replace GitHub from a signed-in browser session",
      403,
      "FORBIDDEN",
    );
  }

  const fail = (message: string, status: number, errorCode: "BAD_REQUEST" | "CONFLICT" | "STEP_UP_REQUIRED" | "UNAVAILABLE") => {
    logApiRoute(request, {
      requestId,
      action,
      userId: user.id,
      startedAt,
      success: false,
      status,
      errorCode,
    });
    return jsonError(message, status, errorCode);
  };

  const githubIdentity = (user.identities ?? []).find(
    (identity) => identity?.provider?.trim().toLowerCase() === "github",
  );
  if (!githubIdentity) {
    return fail("The stale GitHub identity is no longer linked", 409, "CONFLICT");
  }

  const hasFallbackIdentity = (user.identities ?? []).some(
    (identity) => identity?.provider?.trim().toLowerCase() !== "github",
  );
  if (!hasFallbackIdentity) {
    return fail(
      "Add another sign-in method before replacing your only linked identity",
      409,
      "CONFLICT",
    );
  }

  const stepUp = await resolveSecurityStepUp(user.id);
  if (!stepUp.ok) {
    return fail(
      "Verify this device before replacing the linked GitHub account",
      403,
      "STEP_UP_REQUIRED",
    );
  }

  const connection = buildGithubAccountConnectionState(user);
  const health = await resolveGithubExternalAccountHealth({
    linked: connection.linked,
    githubId: connection.githubId,
    username: connection.username,
    cacheTtlMs: 0,
  });
  if (health.state === "available") {
    return fail(
      "The linked GitHub account is available. Refresh the page before replacing it.",
      409,
      "CONFLICT",
    );
  }
  if (health.state !== "unavailable") {
    return fail(
      "GitHub account status could not be verified. Try again when GitHub is available.",
      503,
      "UNAVAILABLE",
    );
  }

  const unlinkResult = await auth.supabase.auth.unlinkIdentity(githubIdentity);
  if (unlinkResult.error) {
    return fail(
      unlinkResult.error.message || "The stale GitHub identity could not be detached",
      400,
      "BAD_REQUEST",
    );
  }

  // ponytail: replacement is rare; clearing the tiny shared health cache avoids
  // carrying either the deleted id or login into the new OAuth callback.
  clearGithubAccountHealthCache();
  await recordSecurityEvent({
    userId: user.id,
    eventType: "github_account_replacement_started",
    request,
    metadata: {
      previousGithubId: connection.githubId,
      previousGithubLogin: connection.username,
    },
  }).catch((error) => {
    logger.warn("github.account.replacement.audit_failed", {
      requestId,
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const response = jsonSuccess(
    { detached: true },
    "The unavailable GitHub account was detached",
  );
  clearGithubImportAccessCookie(response);
  logApiRoute(request, {
    requestId,
    action,
    userId: user.id,
    startedAt,
    success: true,
    status: 200,
  });
  return response;
}
