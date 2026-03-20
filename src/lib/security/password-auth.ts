import { createServerClient } from "@supabase/ssr";
import { resolveSupabasePublicEnv } from "@/lib/supabase/env";

export async function verifyPasswordCredential(email: string, password: string): Promise<{
  ok: boolean;
  message?: string;
}> {
  const env = resolveSupabasePublicEnv("security.password-auth");
  const verifier = createServerClient(
    env.url,
    env.anonKey,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    },
  );

  const verifyResult = await verifier.auth.signInWithPassword({
    email,
    password,
  });

  if (verifyResult.error) {
    return {
      ok: false,
      message: verifyResult.error.message || "Current password is incorrect",
    };
  }

  return { ok: true };
}
