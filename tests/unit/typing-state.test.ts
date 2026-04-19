import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTypingDelta,
  deriveTypingUsersFromPresenceState,
  normalizeTrackedConversationIds,
} from '@/lib/chat/typing-state';
import type { PresenceMemberState } from '@/lib/realtime/presence-types';

function createMember(overrides: Partial<PresenceMemberState>): PresenceMemberState {
  return {
    connectionId: overrides.connectionId ?? 'conn-1',
    userId: overrides.userId ?? 'user-1',
    roomType: overrides.roomType ?? 'conversation',
    roomId: overrides.roomId ?? 'conversation-1',
    role: overrides.role ?? 'viewer',
    lastSeenAt: overrides.lastSeenAt ?? Date.now(),
    cursorFrame: overrides.cursorFrame ?? null,
    typing: overrides.typing ?? false,
    typingContext: overrides.typingContext ?? null,
    userName: overrides.userName ?? null,
    profile: overrides.profile ?? null,
  };
}

test('normalizeTrackedConversationIds keeps unique visible conversations without a hard cap', () => {
  const ids = normalizeTrackedConversationIds([
    'conversation-1',
    'conversation-2',
    'conversation-2',
    null,
    undefined,
    'new',
    ...Array.from({ length: 20 }, (_, index) => `conversation-extra-${index}`),
  ]);

  assert.equal(ids[0], 'conversation-1');
  assert.equal(ids[1], 'conversation-2');
  assert.equal(ids.length, 22);
});

test('deriveTypingUsersFromPresenceState excludes the current user and only keeps typing members', () => {
  const users = deriveTypingUsersFromPresenceState([
    createMember({
      userId: 'current-user',
      typing: true,
      userName: 'Current',
    }),
    createMember({
      connectionId: 'conn-2',
      userId: 'other-user',
      typing: true,
      userName: 'Other',
    }),
    createMember({
      connectionId: 'conn-3',
      userId: 'idle-user',
      typing: false,
      userName: 'Idle',
    }),
  ], 'current-user');

  assert.deepEqual(users, [
    {
      id: 'other-user',
      username: null,
      fullName: 'Other',
      avatarUrl: null,
    },
  ]);
});

test('applyTypingDelta adds, updates, and removes members deterministically', () => {
  const firstMember = createMember({
    userId: 'other-user',
    typing: true,
    profile: { username: 'rama', fullName: 'Rama', avatarUrl: null },
  });
  const secondMember = createMember({
    userId: 'other-user',
    typing: true,
    profile: { username: 'rama', fullName: 'Rama Updated', avatarUrl: 'https://example.com/a.png' },
  });

  const inserted = applyTypingDelta({
    currentUsers: [],
    member: firstMember,
    action: 'upsert',
    currentUserId: 'current-user',
  });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]?.fullName, 'Rama');

  const updated = applyTypingDelta({
    currentUsers: inserted,
    member: secondMember,
    action: 'upsert',
    currentUserId: 'current-user',
  });
  assert.equal(updated.length, 1);
  assert.equal(updated[0]?.fullName, 'Rama Updated');
  assert.equal(updated[0]?.avatarUrl, 'https://example.com/a.png');

  const removed = applyTypingDelta({
    currentUsers: updated,
    member: { ...secondMember, typing: false },
    action: 'upsert',
    currentUserId: 'current-user',
  });
  assert.equal(removed.length, 0);
});
