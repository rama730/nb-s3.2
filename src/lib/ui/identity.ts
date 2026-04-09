import { initialsForName, trimOptionalDisplayText } from "@/lib/profile/display";
import { getAvatarGradient } from "@/lib/ui/avatar";

export type IdentityRecord = {
  fullName?: unknown;
  full_name?: unknown;
  username?: unknown;
  avatarUrl?: unknown;
  avatar_url?: unknown;
} | null | undefined;

export type NormalizedIdentityFields = {
  fullName: string | null;
  username: string | null;
  avatarUrl: string | null;
};

export type IdentityPresentation = NormalizedIdentityFields & {
  displayName: string;
  usernameLabel: string | null;
  initials: string;
  gradientClass: string;
  alt: string;
};

export function normalizeIdentityFields(identity: IdentityRecord): NormalizedIdentityFields {
  return {
    fullName: trimOptionalDisplayText(identity?.fullName ?? identity?.full_name),
    username: trimOptionalDisplayText(identity?.username),
    avatarUrl: trimOptionalDisplayText(identity?.avatarUrl ?? identity?.avatar_url),
  };
}

export function buildIdentityPresentation(
  identity: IdentityRecord,
  options: { fallbackDisplayName?: string; fallbackInitials?: string } = {},
): IdentityPresentation {
  const normalized = normalizeIdentityFields(identity);
  const fallbackDisplayName = trimOptionalDisplayText(options.fallbackDisplayName) ?? "User";
  const displayName = normalized.fullName ?? normalized.username ?? fallbackDisplayName;
  const explicitFallbackInitials = trimOptionalDisplayText(options.fallbackInitials);
  const initials =
    !normalized.fullName && !normalized.username && explicitFallbackInitials
      ? explicitFallbackInitials.toUpperCase()
      : initialsForName(normalized.fullName, normalized.username, fallbackDisplayName);

  return {
    ...normalized,
    displayName,
    usernameLabel: normalized.username ? `@${normalized.username}` : null,
    initials,
    gradientClass: getAvatarGradient(normalized.fullName ?? normalized.username ?? fallbackDisplayName),
    alt: displayName,
  };
}
