import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { E2E_AUTH_COOKIE, isE2EAuthFallbackEnabled } from "@/lib/e2e/auth-fallback";
import { resolveSupabasePublicEnv } from "@/lib/supabase/env";
import { getRequestId, logApiRequest } from "@/app/api/_shared";

type E2EAuthBody = {
  email?: string;
  password?: string;
};

function clearLegacyFallbackCookies(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  cookieStore.set(E2E_AUTH_COOKIE, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 0,
  });
  cookieStore.set("x-onboarded", "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 0,
  });
}

async function createE2EAuthClient() {
  const cookieStore = await cookies();
  const env = resolveSupabasePublicEnv("api.e2e.auth");
  const client = createServerClient(env.url, env.anonKey, {
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
  return { client, cookieStore };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  if (!isE2EAuthFallbackEnabled()) {
    logApiRequest(request, {
      requestId,
      action: "e2e.auth.post",
      startedAt,
      status: 404,
      success: false,
      errorCode: "NOT_FOUND",
    });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: E2EAuthBody = {};
  try {
    body = (await request.json()) as E2EAuthBody;
  } catch {
    logApiRequest(request, {
      requestId,
      action: "e2e.auth.post",
      startedAt,
      status: 400,
      success: false,
      errorCode: "BAD_REQUEST",
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const expectedEmail = process.env.E2E_USER_EMAIL;
  const expectedPassword = process.env.E2E_USER_PASSWORD;
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!expectedEmail || !expectedPassword) {
    logApiRequest(request, {
      requestId,
      action: "e2e.auth.post",
      startedAt,
      status: 500,
      success: false,
      errorCode: "INTERNAL_ERROR",
    });
    return NextResponse.json({ error: "E2E credentials are not configured" }, { status: 500 });
  }

  if (email !== expectedEmail.trim().toLowerCase() || password !== expectedPassword) {
    logApiRequest(request, {
      requestId,
      action: "e2e.auth.post",
      startedAt,
      status: 401,
      success: false,
      errorCode: "UNAUTHORIZED",
    });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  try {
    const { client, cookieStore } = await createE2EAuthClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: expectedEmail,
      password: expectedPassword,
    });

    if (error || !data.user) {
      logApiRequest(request, {
        requestId,
        action: "e2e.auth.post",
        startedAt,
        status: 401,
        success: false,
        errorCode: "UNAUTHORIZED",
      });
      return NextResponse.json({ error: error?.message || "Sign in failed" }, { status: 401 });
    }

    clearLegacyFallbackCookies(cookieStore);
    logApiRequest(request, {
      requestId,
      action: "e2e.auth.post",
      startedAt,
      status: 200,
      success: true,
      userId: data.user.id,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logApiRequest(request, {
      requestId,
      action: "e2e.auth.post",
      startedAt,
      status: 500,
      success: false,
      errorCode: "INTERNAL_ERROR",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create test session" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  if (!isE2EAuthFallbackEnabled()) {
    logApiRequest(request, {
      requestId,
      action: "e2e.auth.delete",
      startedAt,
      status: 404,
      success: false,
      errorCode: "NOT_FOUND",
    });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { client, cookieStore } = await createE2EAuthClient();
    await client.auth.signOut({ scope: "local" });
    clearLegacyFallbackCookies(cookieStore);
    logApiRequest(request, {
      requestId,
      action: "e2e.auth.delete",
      startedAt,
      status: 200,
      success: true,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logApiRequest(request, {
      requestId,
      action: "e2e.auth.delete",
      startedAt,
      status: 500,
      success: false,
      errorCode: "INTERNAL_ERROR",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear test session" },
      { status: 500 },
    );
  }
}
