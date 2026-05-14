const asEnabledDefault = (value: string | undefined) =>
  value === "0" || value === "false" ? false : true;

const asRolloutPercent = (value: string | undefined, fallback: number = 100) => {
  if (value === undefined || value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.floor(parsed)));
};

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function isInRolloutCohort(seed: string, percent: number): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const bucket = fnv1a(seed) % 100;
  return bucket < percent;
}

export function resolveFlagWithRollout(
  enabled: boolean,
  rolloutPercent: number,
  seed: string | null | undefined,
): boolean {
  if (!enabled) return false;
  if (rolloutPercent >= 100) return true;
  if (!seed) return false;
  return isInRolloutCohort(seed, rolloutPercent);
}

export const hardeningFeatureFlags = {
  hardeningShellV1: asEnabledDefault(process.env.NEXT_PUBLIC_HARDENING_SHELL_V1),
  hardeningDataV1: asEnabledDefault(process.env.NEXT_PUBLIC_HARDENING_DATA_V1),
  hardeningWorkspaceV1: asEnabledDefault(process.env.NEXT_PUBLIC_HARDENING_WORKSPACE_V1),
  hardeningFilesV1: asEnabledDefault(process.env.NEXT_PUBLIC_HARDENING_FILES_V1),
  hardeningMessagesV1: asEnabledDefault(process.env.NEXT_PUBLIC_HARDENING_MESSAGES_V1),
  hardeningPeopleV1: asEnabledDefault(process.env.NEXT_PUBLIC_HARDENING_PEOPLE_V1),
  hardeningProfileV1: asEnabledDefault(process.env.NEXT_PUBLIC_HARDENING_PROFILE_V1),
  hardeningSecurityV1: asEnabledDefault(process.env.NEXT_PUBLIC_HARDENING_SECURITY_V1),
} as const;

export const hardeningRolloutPercents = {
  shellV1: asRolloutPercent(process.env.NEXT_PUBLIC_HARDENING_SHELL_V1_ROLLOUT_PERCENT, 100),
  dataV1: asRolloutPercent(process.env.NEXT_PUBLIC_HARDENING_DATA_V1_ROLLOUT_PERCENT, 100),
  workspaceV1: asRolloutPercent(process.env.NEXT_PUBLIC_HARDENING_WORKSPACE_V1_ROLLOUT_PERCENT, 100),
  filesV1: asRolloutPercent(process.env.NEXT_PUBLIC_HARDENING_FILES_V1_ROLLOUT_PERCENT, 100),
  messagesV1: asRolloutPercent(process.env.NEXT_PUBLIC_HARDENING_MESSAGES_V1_ROLLOUT_PERCENT, 100),
  peopleV1: asRolloutPercent(process.env.NEXT_PUBLIC_HARDENING_PEOPLE_V1_ROLLOUT_PERCENT, 100),
  profileV1: asRolloutPercent(process.env.NEXT_PUBLIC_HARDENING_PROFILE_V1_ROLLOUT_PERCENT, 100),
  securityV1: asRolloutPercent(process.env.NEXT_PUBLIC_HARDENING_SECURITY_V1_ROLLOUT_PERCENT, 100),
} as const;

export type HardeningDomain =
  | "shellV1"
  | "dataV1"
  | "workspaceV1"
  | "filesV1"
  | "messagesV1"
  | "peopleV1"
  | "profileV1"
  | "securityV1";

const hardeningDomainMap: Record<HardeningDomain, { enabled: boolean; rolloutPercent: number }> = {
  shellV1: {
    enabled: hardeningFeatureFlags.hardeningShellV1,
    rolloutPercent: hardeningRolloutPercents.shellV1,
  },
  dataV1: {
    enabled: hardeningFeatureFlags.hardeningDataV1,
    rolloutPercent: hardeningRolloutPercents.dataV1,
  },
  workspaceV1: {
    enabled: hardeningFeatureFlags.hardeningWorkspaceV1,
    rolloutPercent: hardeningRolloutPercents.workspaceV1,
  },
  filesV1: {
    enabled: hardeningFeatureFlags.hardeningFilesV1,
    rolloutPercent: hardeningRolloutPercents.filesV1,
  },
  messagesV1: {
    enabled: hardeningFeatureFlags.hardeningMessagesV1,
    rolloutPercent: hardeningRolloutPercents.messagesV1,
  },
  peopleV1: {
    enabled: hardeningFeatureFlags.hardeningPeopleV1,
    rolloutPercent: hardeningRolloutPercents.peopleV1,
  },
  profileV1: {
    enabled: hardeningFeatureFlags.hardeningProfileV1,
    rolloutPercent: hardeningRolloutPercents.profileV1,
  },
  securityV1: {
    enabled: hardeningFeatureFlags.hardeningSecurityV1,
    rolloutPercent: hardeningRolloutPercents.securityV1,
  },
};

export function isHardeningDomainEnabled(
  domain: HardeningDomain,
  userId?: string | null,
): boolean {
  const config = hardeningDomainMap[domain];
  return resolveFlagWithRollout(config.enabled, config.rolloutPercent, userId ?? null);
}
