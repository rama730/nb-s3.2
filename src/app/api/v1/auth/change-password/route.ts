import { createServerClient } from "@supabase/ssr";
import { validateCsrf } from "@/lib/security/csrf";
import { resolveSupabasePublicEnv } from "@/lib/supabase/env";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";

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
  if (!currentPassword || !newPassword) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Current password and new password are required", 400, "BAD_REQUEST");
  }
  if (newPassword.length < 8) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("New password must be at least 8 characters", 400, "BAD_REQUEST");
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

  if (!auth.user.email) {
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

  let verifierEnv: { url: string; anonKey: string };
  try {
    verifierEnv = resolveSupabasePublicEnv("api.v1.auth.change-password");
  } catch (error) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Server configuration error", 500, "INTERNAL_ERROR");
  }

  try {
    // Verify current password without mutating current request cookies.
    const verifier = createServerClient(
      verifierEnv.url,
      verifierEnv.anonKey,
      {
        cookies: {
          getAll() {
            return [];
          },
          setAll() {},
        },
      },
    );

    const verifyResult = await verifier.auth.signInWithPassword({
      email: auth.user.email,
      password: currentPassword,
    });
    if (verifyResult.error) {
      logApiRoute(request, {
        requestId,
        action: "auth.changePassword.post",
        userId: auth.user.id,
        startedAt,
        success: false,
        status: 400,
        errorCode: "CURRENT_PASSWORD_INVALID",
      });
      return jsonError("Current password is incorrect", 400, "CURRENT_PASSWORD_INVALID");
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
