import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { validateCsrf } from "@/lib/security/csrf";
import { getTrustedRequestIp } from "@/lib/security/request-ip";
import { getRequestId, jsonError, jsonSuccess, logApiRoute } from "@/app/api/v1/_shared";

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);

  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "auth.verifyEmail.post",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
      logApiRoute(request, {
        requestId,
        action: "auth.verifyEmail.post",
        startedAt,
        success: false,
        status: 401,
        errorCode: "UNAUTHORIZED",
      });
      return jsonError("Not authenticated", 401, "UNAUTHORIZED");
    }

    const ipAddress = getTrustedRequestIp(request) ?? "unknown";
    const [userRate, ipRate] = await Promise.all([
      consumeRateLimit(`verify-email:resend:user:${user.id}`, 1, 60),
      consumeRateLimit(`verify-email:resend:ip:${ipAddress}`, 5, 60),
    ]);

    if (!userRate.allowed || !ipRate.allowed) {
      logApiRoute(request, {
        requestId,
        action: "auth.verifyEmail.post",
        userId: user.id,
        startedAt,
        success: false,
        status: 429,
        errorCode: "RATE_LIMITED",
      });
      return jsonError("Please wait before requesting another verification email.", 429, "RATE_LIMITED");
    }

    const { error } = await supabase.auth.resend({
      type: "signup",
      email: user.email,
    });

    if (error) {
      logApiRoute(request, {
        requestId,
        action: "auth.verifyEmail.post",
        userId: user.id,
        startedAt,
        success: false,
        status: 400,
        errorCode: "BAD_REQUEST",
      });
      return jsonError("Unable to resend verification email.", 400, "BAD_REQUEST");
    }

    logApiRoute(request, {
      requestId,
      action: "auth.verifyEmail.post",
      userId: user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(undefined, "Verification email sent.");
  } catch (error) {
    logApiRoute(request, {
      requestId,
      action: "auth.verifyEmail.post",
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Unable to resend verification email.", 500, "INTERNAL_ERROR");
  }
}
