import type { User } from "@supabase/supabase-js";

export const E2E_AUTH_COOKIE = "e2e_auth_user_id";

export function isE2EAuthFallbackEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (
    process.env.E2E_AUTH_FALLBACK === "1" ||
    process.env.NEXT_PUBLIC_E2E_AUTH_FALLBACK === "1"
  );
}

export function buildE2EFallbackUser(userId: string): User {
  const nowIso = new Date().toISOString();
  return {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email: process.env.E2E_USER_EMAIL ?? "e2e@example.com",
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { onboarded: true, username: "e2e_user" },
    identities: [],
    factors: [],
    created_at: nowIso,
    updated_at: nowIso,
    confirmed_at: nowIso,
    last_sign_in_at: nowIso,
    is_anonymous: false,
  } as User;
}
