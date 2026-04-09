import { validateCsrf } from "@/lib/security/csrf";
import {
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
} from "@/app/api/v1/_shared";
import { createClient } from "@/lib/supabase/server";

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
        return jsonError(error.message || "Failed to bootstrap browser session", 500, "INTERNAL_ERROR");
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
      logApiRoute(request, {
        requestId,
        action: "auth.session.sync",
        startedAt,
        success: false,
        status: 400,
        errorCode: "BAD_REQUEST",
      });
      return jsonError(error.message || "Failed to sync browser session", 400, "BAD_REQUEST");
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
    return jsonError(
      error instanceof Error ? error.message : "Failed to bridge browser session",
      500,
      "INTERNAL_ERROR",
    );
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

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      logApiRoute(request, {
        requestId,
        action: "auth.session.delete",
        userId: user?.id ?? null,
        startedAt,
        success: false,
        status: 400,
        errorCode: "BAD_REQUEST",
      });
      return jsonError(error.message || "Failed to clear browser session", 400, "BAD_REQUEST");
    }

    logApiRoute(request, {
      requestId,
      action: "auth.session.delete",
      userId: user?.id ?? null,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(undefined, "Browser session cleared");
  } catch (error) {
    logApiRoute(request, {
      requestId,
      action: "auth.session.delete",
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError(
      error instanceof Error ? error.message : "Failed to clear browser session",
      500,
      "INTERNAL_ERROR",
    );
  }
}
