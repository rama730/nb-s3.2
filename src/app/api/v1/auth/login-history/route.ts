import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

type LoginHistoryEntry = {
  id: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  location?: string;
};

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:login-history:get", 120, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.loginHistory.get",
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
      action: "auth.loginHistory.get",
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
      action: "auth.loginHistory.get",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
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
      WHERE user_id = ${auth.user.id}::uuid
      ORDER BY created_at DESC
      LIMIT 20
    `);

    const history: LoginHistoryEntry[] = rows.map((row) => ({
      id: row.id,
      ip_address: row.ip?.trim() || "unknown",
      user_agent: row.user_agent?.trim() || "Unknown device",
      created_at:
        typeof row.created_at === "string"
          ? row.created_at
          : row.created_at.toISOString(),
    }));

    logApiRoute(request, {
      requestId,
      action: "auth.loginHistory.get",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ history });
  } catch (error) {
    console.error("[api/v1/auth/login-history] failed", error);
    logApiRoute(request, {
      requestId,
      action: "auth.loginHistory.get",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to load login history", 500, "INTERNAL_ERROR");
  }
}
