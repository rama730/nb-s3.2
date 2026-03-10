import {
  enforceRouteLimit,
  getSessionIdentifier,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { isSecurityHardeningEnabled } from "@/lib/features/security";

type SecurityPayload = {
  mfaFactors: Array<{
    id: string;
    type: "totp" | "phone";
    friendly_name?: string;
    created_at?: string;
    status: "verified" | "unverified";
  }>;
  passkeys: Array<{
    id: string;
    name: string;
    created_at?: string;
    last_used?: string;
  }>;
  sessions: Array<{
    id: string;
    device_info: { userAgent: string };
    ip_address: string;
    last_active: string;
    is_current?: boolean;
  }>;
  loginHistory: Array<{
    id: string;
    ip_address: string;
    user_agent: string;
    created_at: string;
    location?: string;
  }>;
};

async function fetchLoginHistory(userId: string, limit: number): Promise<SecurityPayload["loginHistory"]> {
  const rows = await db.execute<{
    id: string;
    ip: string | null;
    user_agent: string | null;
    created_at: Date | string;
  }>(sql`
    SELECT
      id::text AS id,
      ip,
      user_agent,
      created_at
    FROM auth.sessions
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    id: row.id,
    ip_address: row.ip?.trim() || "unknown",
    user_agent: row.user_agent?.trim() || "Unknown device",
    created_at:
      typeof row.created_at === "string"
        ? row.created_at
        : row.created_at.toISOString(),
  }));
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:security:get", 120, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "security.get",
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
      action: "security.get",
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
      action: "security.get",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const securityHardeningEnabled = isSecurityHardeningEnabled(auth.user.id);
    const payload: SecurityPayload = {
      mfaFactors: [],
      passkeys: [],
      sessions: [],
      loginHistory: [],
    };

    const mfaApi = (auth.supabase.auth as any)?.mfa;
    if (mfaApi?.listFactors) {
      const mfaResult = await mfaApi.listFactors();
      const allFactors = Array.isArray(mfaResult?.data?.all) ? mfaResult.data.all : [];

      payload.mfaFactors = allFactors
        .filter((factor: any) => factor?.factor_type === "totp" || factor?.factor_type === "phone")
        .map((factor: any) => {
          const createdAt = typeof factor.created_at === "string" ? factor.created_at : undefined;
          return {
            id: String(factor.id),
            type: factor.factor_type === "phone" ? "phone" : "totp",
            friendly_name: factor.friendly_name || undefined,
            ...(createdAt ? { created_at: createdAt } : {}),
            status: factor.status === "verified" ? "verified" : "unverified",
          };
        });

      payload.passkeys = allFactors
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
    }

    const {
      data: { session },
    } = await auth.supabase.auth.getSession();
    if (session) {
      const currentSessionId =
        getSessionIdentifier(session) ?? `display:${auth.user.id}:current`;
      const userAgent = request.headers.get("user-agent") || "Unknown device";
      const now = new Date().toISOString();
      const forwardedFor = request.headers.get("x-forwarded-for") || "";
      const ipAddress = forwardedFor.split(",")[0]?.trim() || "unknown";

      payload.sessions = [
        {
          id: currentSessionId,
          device_info: { userAgent },
          ip_address: ipAddress,
          last_active: now,
          is_current: true,
        },
      ];

    }

    payload.loginHistory = await fetchLoginHistory(auth.user.id, securityHardeningEnabled ? 20 : 10);
    logApiRoute(request, {
      requestId,
      action: "security.get",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(payload);
  } catch (error) {
    console.error("[api/v1/security] failed", error);
    logApiRoute(request, {
      requestId,
      action: "security.get",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to load security data", 500, "INTERNAL_ERROR");
  }
}
