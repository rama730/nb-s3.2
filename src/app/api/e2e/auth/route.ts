import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { E2E_AUTH_COOKIE, isE2EAuthFallbackEnabled } from "@/lib/e2e/auth-fallback";

export async function POST(request: Request) {
  if (!isE2EAuthFallbackEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { email?: string; password?: string } = {};
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const expectedEmail = process.env.E2E_USER_EMAIL;
  const expectedPassword = process.env.E2E_USER_PASSWORD;
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!expectedEmail || !expectedPassword) {
    return NextResponse.json({ error: "E2E credentials are not configured" }, { status: 500 });
  }
  if (email !== expectedEmail.trim().toLowerCase() || password !== expectedPassword) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const [profile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.email, expectedEmail))
    .limit(1);

  if (!profile?.id) {
    return NextResponse.json({ error: "Fixture user profile not found" }, { status: 404 });
  }

  const cookieStore = await cookies();
  cookieStore.set(E2E_AUTH_COOKIE, profile.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 60 * 60 * 8,
  });
  cookieStore.set("x-onboarded", "1", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 60 * 60,
  });

  return NextResponse.json({ success: true });
}

export async function DELETE() {
  if (!isE2EAuthFallbackEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const cookieStore = await cookies();
  cookieStore.set(E2E_AUTH_COOKIE, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 0,
  });
  return NextResponse.json({ success: true });
}
