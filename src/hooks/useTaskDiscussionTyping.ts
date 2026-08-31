'use client';

import { useCallback, useMemo } from 'react';

import { toPresenceTypingUser, type PresenceMemberState } from '@/lib/realtime/presence-types';
import type { TaskDiscussionTypingUser } from '@/lib/projects/task-discussion';

import { usePresenceTyping } from './usePresenceTyping';

type TaskDiscussionTypingSnapshot = {
  topLevel: TaskDiscussionTypingUser[];
  repliesByParentId: Record<string, TaskDiscussionTypingUser[]>;
};

type SendTypingParams = {
  isTyping: boolean;
  parentCommentId?: string | null;
};

function isTaskCommentTypingMember(member: PresenceMemberState, currentUserId: string | null) {
  return (
    member.typing
    && member.userId !== currentUserId
    && member.typingContext?.scope === 'task_comment'
  );
}

function normalizeTypingSnapshot(members: Iterable<PresenceMemberState>): TaskDiscussionTypingSnapshot {
  const topLevel: TaskDiscussionTypingUser[] = [];
  const repliesByParentId: Record<string, TaskDiscussionTypingUser[]> = {};

  for (const member of members) {
    const typingUser = toPresenceTypingUser(member);
    const parentCommentId = member.typingContext?.scope === 'task_comment'
      ? member.typingContext.parentCommentId ?? null
      : null;
    if (!parentCommentId) {
      topLevel.push(typingUser);
      continue;
    }

    repliesByParentId[parentCommentId] = [...(repliesByParentId[parentCommentId] ?? []), typingUser];
  }

  return {
    topLevel,
    repliesByParentId,
  };
}

export function useTaskDiscussionTyping(taskId: string | null, enabled = true) {
  const {
    typingMembers,
    presenceStatus,
    sendTyping: sendPresenceTyping,
  } = usePresenceTyping({
    roomType: 'task',
    roomId: taskId,
    enabled,
    requireCurrentUser: true,
    shouldTrackMember: isTaskCommentTypingMember,
  });

  const snapshot = useMemo(() => normalizeTypingSnapshot(typingMembers), [typingMembers]);
  const sendTyping = useCallback(async (params: SendTypingParams) => {
    await sendPresenceTyping({
      isTyping: params.isTyping,
      context: params.isTyping
        ? {
            scope: 'task_comment',
            parentCommentId: params.parentCommentId ?? null,
          }
        : null,
    });
  }, [sendPresenceTyping]);

  return useMemo(() => ({
    topLevelTypingUsers: snapshot.topLevel,
    replyTypingUsersByParentId: snapshot.repliesByParentId,
    presenceStatus,
    sendTyping,
  }), [presenceStatus, sendTyping, snapshot.repliesByParentId, snapshot.topLevel]);
}
