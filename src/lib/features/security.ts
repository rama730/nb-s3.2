import { hardeningFeatureFlags, isHardeningDomainEnabled } from "@/lib/features/hardening";

const asEnabledDefault = (value: string | undefined) =>
  value === "0" || value === "false" ? false : true;

export const securityFeatureFlags = {
  hardeningV1:
    process.env.NEXT_PUBLIC_SECURITY_HARDENING_V1 !== undefined
      ? asEnabledDefault(process.env.NEXT_PUBLIC_SECURITY_HARDENING_V1)
      : hardeningFeatureFlags.hardeningSecurityV1,
} as const;

export function isSecurityHardeningEnabled(userId?: string | null): boolean {
  if (!securityFeatureFlags.hardeningV1) return false;
  return isHardeningDomainEnabled("securityV1", userId);
}

