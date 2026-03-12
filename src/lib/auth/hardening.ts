const DEFAULT_AUTH_HARDENING_PHASE = "9";

export function getAuthHardeningPhase(): string {
  const raw = process.env.AUTH_HARDENING_PHASE?.trim();
  if (!raw) return DEFAULT_AUTH_HARDENING_PHASE;
  return raw;
}
