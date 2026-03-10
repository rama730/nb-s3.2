import {
    hardeningFeatureFlags,
    isHardeningDomainEnabled,
} from '@/lib/features/hardening';

export const workspaceFeatureFlags = {
    hardeningV1:
        process.env.NEXT_PUBLIC_WORKSPACE_HARDENING_V1 !== undefined
            ? process.env.NEXT_PUBLIC_WORKSPACE_HARDENING_V1 !== '0' &&
              process.env.NEXT_PUBLIC_WORKSPACE_HARDENING_V1 !== 'false'
            : hardeningFeatureFlags.hardeningWorkspaceV1,
} as const;

export function isWorkspaceHardeningEnabled(userId?: string | null): boolean {
    if (!workspaceFeatureFlags.hardeningV1) return false;
    return isHardeningDomainEnabled("workspaceV1", userId);
}
