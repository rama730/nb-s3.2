import { validateCsrf } from "@/lib/security/csrf";
import { cookies } from "next/headers";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
} from "@/app/api/v1/_shared";
import { createClient } from "@/lib/supabase/server";
import { clearGithubImportAccessCookie } from "@/lib/github/import-access-cookie";

const AUTH_COOKIE_MARKERS = ["auth-token", "sb-access-token", "sb-refresh-token"];

function isBrowserAuthCookie(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("sb")
    && AUTH_COOKIE_MARKERS.some((marker) => normalized.includes(marker));
}

function expireBrowserSessionCookies(
  response: ReturnType<typeof jsonSuccess>,
  cookieNames: string[],
) {
  for (const name of cookieNames) {
    if (!isBrowserAuthCookie(name) && !name.startsWith("onboarding_complete_")) continue;
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });
  }
}

type SessionBridgeBody = {
  mode?: "bootstrap" | "sync";
  accessToken?: string;
  refreshToken?: string;
};

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

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "auth.session.post",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:session", 240, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.session.post",
      startedAt,
      success: false,
      status: 429,
      errorCode: "RATE_LIMITED",
    });
    return limitResponse;
  }

  const supabase = await createClient();
  const body = (await request.json().catch(() => null)) as SessionBridgeBody | null;
  const mode = body?.mode === "bootstrap" ? "bootstrap" : "sync";

  try {
    if (mode === "bootstrap") {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        logApiRoute(request, {
          requestId,
          action: "auth.session.bootstrap",
          startedAt,
          success: false,
          status: 500,
          errorCode: "INTERNAL_ERROR",
        });
        return jsonError("Failed to bootstrap browser session", 500, "INTERNAL_ERROR");
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      logApiRoute(request, {
        requestId,
        action: "auth.session.bootstrap",
        userId: user?.id ?? null,
        startedAt,
        success: true,
        status: 200,
      });
      return jsonSuccess({ session: shapeSessionPayload(data.session) });
    }

    const accessToken = body?.accessToken?.trim() || "";
    const refreshToken = body?.refreshToken?.trim() || "";
    if (!accessToken || !refreshToken) {
      logApiRoute(request, {
        requestId,
        action: "auth.session.sync",
        startedAt,
        success: false,
        status: 400,
        errorCode: "BAD_REQUEST",
      });
      return jsonError("Access and refresh tokens are required", 400, "BAD_REQUEST");
    }

    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (currentSession && currentSession.user) {
        logApiRoute(request, {
          requestId,
          action: "auth.session.sync.already_used_recovered",
          userId: currentSession.user.id,
          startedAt,
          success: true,
          status: 200,
        });
        return jsonSuccess({ session: shapeSessionPayload(currentSession) });
      }

      logApiRoute(request, {
        requestId,
        action: "auth.session.sync",
        startedAt,
        success: false,
        status: 400,
        errorCode: "BAD_REQUEST",
      });
      return jsonError("Failed to sync browser session", 400, "BAD_REQUEST");
    }

    logApiRoute(request, {
      requestId,
      action: "auth.session.sync",
      userId: data.user?.id ?? null,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ session: shapeSessionPayload(data.session) });
  } catch (error) {
    logApiRoute(request, {
      requestId,
      action: mode === "bootstrap" ? "auth.session.bootstrap" : "auth.session.sync",
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to bridge browser session", 500, "INTERNAL_ERROR");
  }
}

export async function DELETE(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "auth.session.delete",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:session", 240, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.session.delete",
      startedAt,
      success: false,
      status: 429,
      errorCode: "RATE_LIMITED",
    });
    return limitResponse;
  }

  const cookieStore = await cookies();
  const cookieNames = cookieStore.getAll().map(({ name }) => name);
  let userId: string | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;

    // A normal logout is local to this browser. If Supabase reports an already
    // missing/stale refresh token, explicit cookie expiry below still completes
    // the idempotent logout instead of trapping the user in a redirect loop.
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Local cookie removal is the source of truth for this browser's logout.
  }

  const response = jsonSuccess(undefined, "Browser session cleared");
  expireBrowserSessionCookies(response, cookieNames);
  clearGithubImportAccessCookie(response);

  logApiRoute(request, {
    requestId,
    action: "auth.session.delete",
    userId,
    startedAt,
    success: true,
    status: 200,
  });
  return response;
}
