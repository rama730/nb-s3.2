import { hardeningFeatureFlags, isHardeningDomainEnabled } from "@/lib/features/hardening";

const asEnabledDefault = (value: string | undefined) =>
  value === "0" || value === "false" ? false : true;

export const messagesFeatureFlags = {
  hardeningV1:
    process.env.NEXT_PUBLIC_MESSAGES_HARDENING_V1 !== undefined
      ? asEnabledDefault(process.env.NEXT_PUBLIC_MESSAGES_HARDENING_V1)
      : hardeningFeatureFlags.hardeningMessagesV1,
} as const;

export function isMessagesHardeningEnabled(userId?: string | null): boolean {
  if (!messagesFeatureFlags.hardeningV1) return false;
  return isHardeningDomainEnabled("messagesV1", userId);
}

