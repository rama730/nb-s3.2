import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";

type PasskeyPayload = {
  id: string;
  name: string;
  created_at?: string;
  last_used?: string;
};

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:passkeys:get", 120, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.passkeys.get",
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
      action: "auth.passkeys.get",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return auth.response;
  }

  try {
    const mfaApi = (auth.supabase.auth as any)?.mfa;
    if (!mfaApi?.listFactors) {
      logApiRoute(request, {
        requestId,
        action: "auth.passkeys.get",
        userId: auth.user?.id ?? null,
        startedAt,
        success: true,
        status: 200,
      });
      return jsonSuccess({ passkeys: [] as PasskeyPayload[] }, "Passkeys are not available for this project");
    }

    const mfaResult = await mfaApi.listFactors();
    const allFactors = Array.isArray(mfaResult?.data?.all) ? mfaResult.data.all : [];
    const passkeys: PasskeyPayload[] = allFactors
      .filter((factor: any) => factor?.factor_type === "webauthn")
      .map((factor: any) => {
        const createdAt = typeof factor.created_at === "string" ? factor.created_at : undefined;
        return {
          id: String(factor.id),
          name: factor.friendly_name || "Passkey",
          ...(createdAt ? { created_at: createdAt } : {}),
          last_used: factor.last_challenged_at || undefined,
        };
      });

    logApiRoute(request, {
      requestId,
      action: "auth.passkeys.get",
      userId: auth.user?.id ?? null,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ passkeys });
  } catch (error) {
    console.error("[api/v1/auth/passkeys] failed", error);
    logApiRoute(request, {
      requestId,
      action: "auth.passkeys.get",
      userId: auth.user?.id ?? null,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to load passkeys", 500, "INTERNAL_ERROR");
  }
}
