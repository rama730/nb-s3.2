import { createServerClient } from "@supabase/ssr";
import { resolveSupabasePublicEnv } from "@/lib/supabase/env";

type PasswordVerificationResult = {
  ok: boolean;
  message?: string;
  reason?: "invalid_credentials" | "email_not_confirmed" | "verification_failed";
};

type PasswordVerifier = {
  auth: {
    signInWithPassword(credentials: { email: string; password: string }): Promise<{
      error?: {
        message?: string | null;
        code?: string | null;
        name?: string | null;
        status?: number | null;
      } | null;
    }>;
    signOut(): Promise<unknown>;
  };
};

function isInvalidCredentialError(error: {
  message?: string | null;
  code?: string | null;
  name?: string | null;
  status?: number | null;
}): boolean {
  const message = typeof error.message === "string" ? error.message.trim().toLowerCase() : "";
  const code = typeof error.code === "string" ? error.code.trim().toLowerCase() : "";
  const name = typeof error.name === "string" ? error.name.trim().toLowerCase() : "";
  const status = typeof error.status === "number" ? error.status : null;

  if (code === "invalid_credentials" || code === "invalid_login_credentials") {
    return true;
  }

  if (name === "authapierror" && status === 400) {
    return /invalid|credential|password/i.test(message);
  }

  if (status === 401) {
    return true;
  }

  return /invalid login credentials|invalid credentials|incorrect password|wrong password|invalid email or password/i.test(message);
}

function isEmailNotConfirmedError(error: {
  message?: string | null;
  code?: string | null;
  name?: string | null;
  status?: number | null;
}): boolean {
  const message = typeof error.message === "string" ? error.message.trim().toLowerCase() : "";
  const code = typeof error.code === "string" ? error.code.trim().toLowerCase() : "";

  return code === "email_not_confirmed"
    || /email (address )?(is )?not confirmed|email not confirmed|confirm your email/i.test(message);
}

async function verifyPasswordCredentialWithVerifier(
  verifier: PasswordVerifier,
  email: string,
  password: string,
): Promise<PasswordVerificationResult> {
  const verifyResult = await verifier.auth.signInWithPassword({
    email,
    password,
  });

  if (verifyResult.error) {
    const message = verifyResult.error.message?.trim() || undefined;
    const emailNotConfirmed = isEmailNotConfirmedError(verifyResult.error);
    const invalidCredentials = isInvalidCredentialError(verifyResult.error);
    return {
      ok: false,
      reason: emailNotConfirmed
        ? "email_not_confirmed"
        : invalidCredentials
          ? "invalid_credentials"
          : "verification_failed",
      message: message || (
        emailNotConfirmed
          ? "Confirm your email address before verifying your password"
          : invalidCredentials
            ? "Current password is incorrect"
            : "Unable to verify password"
      ),
    };
  }

  try {
    await verifier.auth.signOut();
  } catch {}

  return { ok: true };
}

export async function verifyPasswordCredential(email: string, password: string): Promise<PasswordVerificationResult> {
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

  return verifyPasswordCredentialWithVerifier(verifier, email, password);
}

export const __testOnly = {
  verifyPasswordCredentialWithVerifier,
};
