import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";

type MfaFactorPayload = {
  id: string;
  type: "totp" | "phone";
  friendly_name?: string;
  created_at?: string;
  status: "verified" | "unverified";
};

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:mfa:factors:get", 120, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.mfaFactors.get",
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
      action: "auth.mfaFactors.get",
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
        action: "auth.mfaFactors.get",
        userId: auth.user?.id ?? null,
        startedAt,
        success: true,
        status: 200,
      });
      return jsonSuccess({ factors: [] as MfaFactorPayload[] }, "MFA factors are not available for this project");
    }

    const mfaResult = await mfaApi.listFactors();
    const allFactors = Array.isArray(mfaResult?.data?.all) ? mfaResult.data.all : [];
    const factors: MfaFactorPayload[] = allFactors
      .filter((factor: any) => factor?.factor_type === "totp" || factor?.factor_type === "phone")
      .map((factor: any) => ({
        id: String(factor.id),
        type: factor.factor_type === "phone" ? "phone" : "totp",
        friendly_name: factor.friendly_name || undefined,
        created_at: typeof factor.created_at === "string" ? factor.created_at : undefined,
        status: factor.status === "verified" ? "verified" : "unverified",
      }));

    logApiRoute(request, {
      requestId,
      action: "auth.mfaFactors.get",
      userId: auth.user?.id ?? null,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ factors });
  } catch (error) {
    console.error("[api/v1/auth/mfa/factors] failed", error);
    logApiRoute(request, {
      requestId,
      action: "auth.mfaFactors.get",
      userId: auth.user?.id ?? null,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to load MFA factors", 500, "INTERNAL_ERROR");
  }
}
