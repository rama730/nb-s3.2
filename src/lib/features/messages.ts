import { resolveFlagWithRollout } from '@/lib/features/hardening';

const asEnabledDefault = (value: string | undefined | null, fallback: boolean = true) => {
    if (value === undefined || value === null) return fallback;
    const trimmed = value.trim().toLowerCase();
    if (trimmed === '') return fallback;
    return trimmed !== '0' && trimmed !== 'false';
};

const asRolloutPercent = (value: string | undefined, fallback: number = 100) => {
    if (value === undefined || value === null || value.trim() === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(100, Math.floor(parsed)));
};

const messagingFeatureConfig = {
    structuredActions: {
        enabled: asEnabledDefault(process.env.NEXT_PUBLIC_MESSAGES_STRUCTURED_ACTIONS),
        rolloutPercent: asRolloutPercent(process.env.NEXT_PUBLIC_MESSAGES_STRUCTURED_ACTIONS_ROLLOUT_PERCENT, 100),
    },
    privateFollowUps: {
        enabled: asEnabledDefault(process.env.NEXT_PUBLIC_MESSAGES_PRIVATE_FOLLOW_UPS),
        rolloutPercent: asRolloutPercent(process.env.NEXT_PUBLIC_MESSAGES_PRIVATE_FOLLOW_UPS_ROLLOUT_PERCENT, 100),
    },
    activityBridges: {
        enabled: asEnabledDefault(process.env.NEXT_PUBLIC_MESSAGES_ACTIVITY_BRIDGES),
        rolloutPercent: asRolloutPercent(process.env.NEXT_PUBLIC_MESSAGES_ACTIVITY_BRIDGES_ROLLOUT_PERCENT, 100),
    },
    guidedFirstContact: {
        enabled: asEnabledDefault(process.env.NEXT_PUBLIC_MESSAGES_GUIDED_FIRST_CONTACT),
        rolloutPercent: asRolloutPercent(process.env.NEXT_PUBLIC_MESSAGES_GUIDED_FIRST_CONTACT_ROLLOUT_PERCENT, 100),
    },
    denormalizedInboxRealtime: {
        enabled: asEnabledDefault(process.env.NEXT_PUBLIC_MESSAGES_DENORMALIZED_INBOX_REALTIME),
        rolloutPercent: asRolloutPercent(process.env.NEXT_PUBLIC_MESSAGES_DENORMALIZED_INBOX_REALTIME_ROLLOUT_PERCENT, 100),
    },
} as const;

export const messagesFeatureFlags = {
    structuredActions: messagingFeatureConfig.structuredActions.enabled,
    privateFollowUps: messagingFeatureConfig.privateFollowUps.enabled,
    activityBridges: messagingFeatureConfig.activityBridges.enabled,
    guidedFirstContact: messagingFeatureConfig.guidedFirstContact.enabled,
    denormalizedInboxRealtime: messagingFeatureConfig.denormalizedInboxRealtime.enabled,
} as const;

export const messagesRolloutPercents = {
    structuredActions: messagingFeatureConfig.structuredActions.rolloutPercent,
    privateFollowUps: messagingFeatureConfig.privateFollowUps.rolloutPercent,
    activityBridges: messagingFeatureConfig.activityBridges.rolloutPercent,
    guidedFirstContact: messagingFeatureConfig.guidedFirstContact.rolloutPercent,
    denormalizedInboxRealtime: messagingFeatureConfig.denormalizedInboxRealtime.rolloutPercent,
} as const;

function resolveMessagingFlag(
    key: keyof typeof messagingFeatureConfig,
    userId?: string | null,
): boolean {
    const config = messagingFeatureConfig[key];
    return resolveFlagWithRollout(config.enabled, config.rolloutPercent, userId ?? null);
}

/**
 * Messages feature flags.
 *
 * V2 is the only active messaging system. The V1 codepath and its
 * `hardeningV1` flag have been removed.
 */
export function isMessagesV2Enabled(_userId?: string | null): boolean {
    return true;
}

export function isMessagingStructuredActionsEnabled(userId?: string | null): boolean {
    return resolveMessagingFlag('structuredActions', userId);
}

export function isMessagingPrivateFollowUpsEnabled(userId?: string | null): boolean {
    return resolveMessagingFlag('privateFollowUps', userId);
}

export function isMessagingActivityBridgesEnabled(userId?: string | null): boolean {
    return resolveMessagingFlag('activityBridges', userId);
}

export function isMessagingGuidedFirstContactEnabled(userId?: string | null): boolean {
    return resolveMessagingFlag('guidedFirstContact', userId);
}

export function isMessagingDenormalizedInboxRealtimeEnabled(userId?: string | null): boolean {
    return resolveMessagingFlag('denormalizedInboxRealtime', userId);
}
