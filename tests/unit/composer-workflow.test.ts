import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSendFromCapability,
  getComposerWorkflowNotice,
} from '@/lib/chat/composer-workflow';
import type { ConversationCapabilityV2 } from '@/app/actions/messaging/v2';

function createCapability(overrides: Partial<ConversationCapabilityV2>): ConversationCapabilityV2 {
  return {
    conversationType: overrides.conversationType ?? 'dm',
    status: overrides.status ?? 'connected',
    canSend: overrides.canSend ?? true,
    blocked: overrides.blocked ?? false,
    messagePrivacy: overrides.messagePrivacy ?? 'connections',
    isConnected: overrides.isConnected ?? true,
    isPendingIncoming: overrides.isPendingIncoming ?? false,
    isPendingOutgoing: overrides.isPendingOutgoing ?? false,
    canInvite: overrides.canInvite ?? true,
    connectionId: overrides.connectionId ?? null,
    hasActiveApplication: overrides.hasActiveApplication ?? false,
    isApplicant: overrides.isApplicant ?? false,
    isCreator: overrides.isCreator ?? false,
    activeApplicationId: overrides.activeApplicationId ?? null,
    activeApplicationStatus: overrides.activeApplicationStatus ?? null,
    activeProjectId: overrides.activeProjectId ?? null,
  };
}

test('canSendFromCapability blocks deleted-project threads even if canSend is true', () => {
  assert.equal(
    canSendFromCapability(createCapability({
      canSend: true,
      activeApplicationStatus: 'project_deleted',
    })),
    false,
  );
});

test('getComposerWorkflowNotice returns a loading notice before capability resolves', () => {
  const notice = getComposerWorkflowNotice(null);
  assert.ok(notice);
  assert.equal(notice?.badge, 'Permissions');
  assert.equal(notice?.actionLabel, null);
});

test('getComposerWorkflowNotice returns the correct connection action state', () => {
  const notice = getComposerWorkflowNotice(createCapability({
    canSend: false,
    status: 'pending_received',
    isPendingIncoming: true,
  }));

  assert.ok(notice);
  assert.equal(notice?.badge, 'Connection request');
  assert.equal(notice?.actionLabel, 'Accept request');
});

test('getComposerWorkflowNotice returns the correct application workflow controls', () => {
  const notice = getComposerWorkflowNotice(createCapability({
    canSend: true,
    hasActiveApplication: true,
    activeApplicationId: 'application-1',
    activeApplicationStatus: 'rejected',
    isCreator: true,
  }));

  assert.ok(notice);
  assert.equal(notice?.badge, 'Application Rejected');
  assert.equal(notice?.canReopen, true);
  assert.equal(notice?.canAccept, false);
});
