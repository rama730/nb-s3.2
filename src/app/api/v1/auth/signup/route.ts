import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";

import { consumeRateLimit } from "@/lib/security/rate-limit";
import { validateCsrf } from "@/lib/security/csrf";
import { getTrustedRequestIp } from "@/lib/security/request-ip";
import { getPasswordPolicyResult } from "@/lib/security/password-policy";
import { resolveSupabasePublicEnv } from "@/lib/supabase/env";
import { resolveSupabaseServerCookieOptions } from "@/lib/supabase/cookie-options";
import { getRequestId, jsonError, jsonSuccess, logApiRoute } from "@/app/api/v1/_shared";

const signUpSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  fullName: z.string().trim().max(120).optional(),
  captchaToken: z.string().trim().min(1).max(4096).optional(),
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

  const ipRate = await consumeRateLimit(`auth-signup:ip:${ipAddress}`, 10, 60);
  if (!ipRate.allowed) {
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
    const supabase = await createUnauthenticatedSupabaseClient();
    const result = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        ...(parsed.data.captchaToken ? { captchaToken: parsed.data.captchaToken } : {}),
        data: {
          full_name: parsed.data.fullName || "",
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

    logApiRoute(request, {
      requestId,
      action: "auth.signup.post",
      userId: result.data.user?.id ?? null,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({
      session: shapeSessionPayload(result.data.session),
      user: result.data.user
        ? {
            id: result.data.user.id,
            email: result.data.user.email ?? null,
          }
        : null,
    });
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
