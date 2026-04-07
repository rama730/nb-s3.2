import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isMessagingActivityBridgesEnabled,
    isMessagingDenormalizedInboxRealtimeEnabled,
    isMessagingGuidedFirstContactEnabled,
    isMessagingPrivateFollowUpsEnabled,
    isMessagingStructuredActionsEnabled,
    messagesFeatureFlags,
    messagesRolloutPercents,
} from '@/lib/features/messages';
import { resolveFlagWithRollout } from '@/lib/features/hardening';

test('messaging structured actions flag stays aligned with rollout config', () => {
    const seed = 'user-structured';
    assert.equal(
        isMessagingStructuredActionsEnabled(seed),
        resolveFlagWithRollout(
            messagesFeatureFlags.structuredActions,
            messagesRolloutPercents.structuredActions,
            seed,
        ),
    );
});

test('messaging follow-up, activity bridge, guidance, and inbox flags stay aligned with rollout config', () => {
    const seed = 'user-messaging';
    assert.equal(
        isMessagingPrivateFollowUpsEnabled(seed),
        resolveFlagWithRollout(
            messagesFeatureFlags.privateFollowUps,
            messagesRolloutPercents.privateFollowUps,
            seed,
        ),
    );
    assert.equal(
        isMessagingActivityBridgesEnabled(seed),
        resolveFlagWithRollout(
            messagesFeatureFlags.activityBridges,
            messagesRolloutPercents.activityBridges,
            seed,
        ),
    );
    assert.equal(
        isMessagingGuidedFirstContactEnabled(seed),
        resolveFlagWithRollout(
            messagesFeatureFlags.guidedFirstContact,
            messagesRolloutPercents.guidedFirstContact,
            seed,
        ),
    );
    assert.equal(
        isMessagingDenormalizedInboxRealtimeEnabled(seed),
        resolveFlagWithRollout(
            messagesFeatureFlags.denormalizedInboxRealtime,
            messagesRolloutPercents.denormalizedInboxRealtime,
            seed,
        ),
    );
});
