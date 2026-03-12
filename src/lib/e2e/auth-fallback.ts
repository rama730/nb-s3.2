export const E2E_AUTH_COOKIE = "e2e_auth_user_id";

export function isE2EAuthFallbackEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const fallbackEnabled =
    process.env.E2E_AUTH_FALLBACK === "1" ||
    process.env.NEXT_PUBLIC_E2E_AUTH_FALLBACK === "1";
  if (!fallbackEnabled) return false;
  const isTestHarness =
    process.env.NODE_ENV === "test" ||
    process.env.PLAYWRIGHT_TEST === "1" ||
    process.env.CI_E2E === "1";
  return isTestHarness;
}
