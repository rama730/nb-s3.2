import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";

import { consumeRateLimit } from "@/lib/security/rate-limit";
import { validateCsrf } from "@/lib/security/csrf";
import { getTrustedRequestIp, getTrustedSubnet } from "@/lib/security/request-ip";
import { getPasswordPolicyResult } from "@/lib/security/password-policy";
import { isLeakedPassword } from "@/lib/security/leaked-password";
import { resolveSupabasePublicEnv } from "@/lib/supabase/env";
import { resolveSupabaseServerCookieOptions } from "@/lib/supabase/cookie-options";
import { getRequestId, jsonError, jsonSuccess, logApiRoute } from "@/app/api/v1/_shared";
import { CURRENT_LEGAL_ACCEPTANCE } from "@/lib/legal/versions";
import { recordCurrentLegalAcceptance } from "@/lib/legal/acceptance";
import { logger } from "@/lib/logger";
import { isDisposableEmail } from "@/lib/validations/disposable-email";
import { verifyTurnstileToken, isTurnstileServerConfigured } from "@/lib/security/turnstile";
import { checkIdempotencyKey, saveIdempotencyResult } from "@/lib/security/idempotency";

const signUpSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  fullName: z.string().trim().max(120).optional(),
  suggestedUsername: z.string().trim().max(30).optional(),
  inviteToken: z.string().trim().max(100).optional(),
  captchaToken: z.string().trim().min(1).max(4096).optional(),
  website_hp: z.string().optional(),
  legalAccepted: z.literal(true),
});

const DUPLICATE_EMAIL_MESSAGE = "This email has already been used to create an account";

function shapeSessionPayload(session: {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number | null;
} | null | undefined) {
  if (!session?.access_token || !session.refresh_token) return null;
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: typeof session.expires_at === "number" ? session.expires_at : null,
  };
}

function isDuplicateSignUpResponse(user: unknown) {
  if (!user || typeof user !== "object") return false;
  const identities = (user as { identities?: unknown }).identities;
  return Array.isArray(identities) && identities.length === 0;
}

async function createUnauthenticatedSupabaseClient() {
  const cookieStore = await cookies();
  const env = resolveSupabasePublicEnv("api.auth.signup");
  return createServerClient(env.url, env.anonKey, {
    cookieOptions: resolveSupabaseServerCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const ipAddress = getTrustedRequestIp(request) ?? "unknown";
  const csrfError = validateCsrf(request);

  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "auth.signup.post",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const subnet = getTrustedSubnet(ipAddress);
  const [ipRate, subnetRate] = await Promise.all([
    consumeRateLimit(`auth-signup:ip:${ipAddress}`, 10, 60),
    consumeRateLimit(`auth-signup:subnet:${subnet}`, 50, 60),
  ]);

  if (!ipRate.allowed || !subnetRate.allowed) {
    logApiRoute(request, {
      requestId,
      action: "auth.signup.post",
      startedAt,
      success: false,
      status: 429,
      errorCode: "RATE_LIMITED",
    });
    return jsonError("Too many signup attempts. Please wait and try again.", 429, "RATE_LIMITED");
  }

  const idempotency = await checkIdempotencyKey(request, "auth-signup", ipAddress);
  if (idempotency.isDuplicate) {
    if (idempotency.isPending) {
      return jsonError("A signup request is already processing. Please wait.", 409, "CONFLICT");
    }
    if (idempotency.cachedResponse) {
      try {
        return Response.json(JSON.parse(idempotency.cachedResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        // Fall through if cached JSON parsing fails
      }
    }
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError("Malformed JSON body", 400, "BAD_REQUEST");
  }

  const parsed = signUpSchema.safeParse(rawBody);
  if (!parsed.success) {
    logApiRoute(request, {
      requestId,
      action: "auth.signup.post",
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Invalid signup request", 400, "BAD_REQUEST");
  }

  // Honeypot field: automated scrapers fill all fields; if populated, silently drop.
  if (parsed.data.website_hp && parsed.data.website_hp.trim().length > 0) {
    logApiRoute(request, {
      requestId,
      action: "auth.signup.post",
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Unable to create account", 400, "BAD_REQUEST");
  }

  // Disposable email check: prevent throwaway bot domains from polluting the database.
  if (isDisposableEmail(parsed.data.email)) {
    logApiRoute(request, {
      requestId,
      action: "auth.signup.post",
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError(
      "Disposable or temporary email addresses are not permitted. Please use a permanent email.",
      400,
      "BAD_REQUEST",
    );
  }

  // Cloudflare Turnstile token verification with timeout circuit-breaker
  if (isTurnstileServerConfigured() && !parsed.data.captchaToken) {
    logApiRoute(request, {
      requestId,
      action: "auth.signup.post",
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Captcha verification is required.", 400, "BAD_REQUEST");
  }

  if (parsed.data.captchaToken) {
    const turnstile = await verifyTurnstileToken({
      token: parsed.data.captchaToken,
      ip: ipAddress,
      expectedAction: "signup",
    });
    if (!turnstile.success) {
      logApiRoute(request, {
        requestId,
        action: "auth.signup.post",
        startedAt,
        success: false,
        status: 400,
        errorCode: "BAD_REQUEST",
      });
      return jsonError(
        turnstile.error || "Captcha verification failed. Please try again.",
        400,
        "BAD_REQUEST",
      );
    }
  }

  const passwordPolicy = getPasswordPolicyResult(parsed.data.password);
  if (!passwordPolicy.ok) {
    logApiRoute(request, {
      requestId,
      action: "auth.signup.post",
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError(passwordPolicy.error || "Password does not meet security requirements.", 400, "BAD_REQUEST");
  }

  try {
    if (await isLeakedPassword(parsed.data.password)) {
      logApiRoute(request, {
        requestId,
        action: "auth.signup.post",
        startedAt,
        success: false,
        status: 400,
        errorCode: "LEAKED_PASSWORD",
      });
      return jsonError(
        "This password has appeared in a data breach. Choose a different password.",
        400,
        "LEAKED_PASSWORD",
      );
    }
  } catch {
    return jsonError(
      "Password safety check is temporarily unavailable. Please try again.",
      503,
      "PASSWORD_SAFETY_UNAVAILABLE",
    );
  }

  try {
    const supabase = await createUnauthenticatedSupabaseClient();
    const shouldForwardCaptcha =
      isTurnstileServerConfigured() &&
      parsed.data.captchaToken &&
      parsed.data.captchaToken !== "dev-interactive-verified";

    const result = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        ...(shouldForwardCaptcha ? { captchaToken: parsed.data.captchaToken } : {}),
        data: {
          full_name: parsed.data.fullName || "",
          username: parsed.data.suggestedUsername || "",
          suggested_username: parsed.data.suggestedUsername || "",
          invite_token: parsed.data.inviteToken || "",
          legal_acceptance: {
            ...CURRENT_LEGAL_ACCEPTANCE,
            acceptedAt: new Date().toISOString(),
            context: "email_signup",
          },
        },
      },
    });

    if (result.error) {
      logApiRoute(request, {
        requestId,
        action: "auth.signup.post",
        startedAt,
        success: false,
        status: 400,
        errorCode: "BAD_REQUEST",
      });
      return jsonError("Unable to create account", 400, "BAD_REQUEST");
    }

    if (isDuplicateSignUpResponse(result.data.user)) {
      logApiRoute(request, {
        requestId,
        action: "auth.signup.post",
        startedAt,
        success: false,
        status: 409,
        errorCode: "CONFLICT",
      });
      return jsonError(DUPLICATE_EMAIL_MESSAGE, 409, "CONFLICT");
    }

    if (result.data.user?.id) {
      try {
        await recordCurrentLegalAcceptance({
          userId: result.data.user.id,
          request,
          context: "email_signup",
        });
      } catch (acceptanceError) {
        // Supabase Auth metadata above remains a second durable copy. Do not
        // strand a newly-created account if the application database is
        // temporarily unavailable; surface the database failure to operators.
        logger.warn("auth.signup.legal-acceptance-record.failed", {
          module: "auth",
          userId: result.data.user.id,
          error: acceptanceError instanceof Error ? acceptanceError.message : String(acceptanceError),
        });
      }
    }

    logApiRoute(request, {
      requestId,
      action: "auth.signup.post",
      userId: result.data.user?.id ?? null,
      startedAt,
      success: true,
      status: 200,
    });
    const responseData = {
      session: shapeSessionPayload(result.data.session),
      user: result.data.user
        ? {
            id: result.data.user.id,
            email: result.data.user.email ?? null,
          }
        : null,
    };

    if (!idempotency.isDuplicate && idempotency.lockToken) {
      await saveIdempotencyResult(
        request,
        "auth-signup",
        JSON.stringify({ success: true, data: responseData }),
        idempotency.lockToken,
        ipAddress,
      );
    }

    return jsonSuccess(responseData);
  } catch (error) {
    logApiRoute(request, {
      requestId,
      action: "auth.signup.post",
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Unable to create account", 500, "INTERNAL_ERROR");
  }
}
