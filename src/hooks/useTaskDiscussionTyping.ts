"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/hooks/use-auth";
import { subscribePresenceRoom, type PresenceStatus } from "@/lib/realtime/presence-client";
import type {
  PresenceMemberProfile,
  PresenceMemberState,
  PresenceTypingContext,
} from "@/lib/realtime/presence-types";
import type { TaskDiscussionTypingUser } from "@/lib/projects/task-discussion";

type RequestedTypingState = {
  isTyping: boolean;
  parentCommentId: string | null;
} | null;

type TaskDiscussionTypingSnapshot = {
  topLevel: TaskDiscussionTypingUser[];
  repliesByParentId: Record<string, TaskDiscussionTypingUser[]>;
};

type SendTypingParams = {
  isTyping: boolean;
  parentCommentId?: string | null;
};

const TYPING_VISIBLE_TTL_MS = 5_500;

function toTypingUser(member: PresenceMemberState): TaskDiscussionTypingUser {
  return {
    id: member.userId,
    username: member.profile?.username ?? null,
    fullName: member.profile?.fullName ?? member.userName ?? null,
    avatarUrl: member.profile?.avatarUrl ?? null,
  };
}

function normalizeTypingSnapshot(
  members: Iterable<PresenceMemberState>,
  currentUserId: string | null,
): TaskDiscussionTypingSnapshot {
  const topLevel: TaskDiscussionTypingUser[] = [];
  const repliesByParentId: Record<string, TaskDiscussionTypingUser[]> = {};

  for (const member of members) {
    if (!member.typing || member.userId === currentUserId) continue;
    if (member.typingContext?.scope !== "task_comment") continue;

    const typingUser = toTypingUser(member);
    const parentCommentId = member.typingContext.parentCommentId ?? null;
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
  const { user, profile } = useAuth();
  const currentUserId = user?.id ?? null;
  const [snapshot, setSnapshot] = useState<TaskDiscussionTypingSnapshot>({
    topLevel: [],
    repliesByParentId: {},
  });
  const [status, setStatus] = useState<PresenceStatus>("disconnected");
  const [isVisible, setIsVisible] = useState(() => (typeof document === "undefined" ? true : !document.hidden));
  const subscriptionRef = useRef<ReturnType<typeof subscribePresenceRoom> | null>(null);
  const memberStatesRef = useRef<Map<string, PresenceMemberState>>(new Map());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastBroadcastRef = useRef(0);
  const requestedTypingStateRef = useRef<RequestedTypingState>(null);

  const currentUserProfile = useMemo<PresenceMemberProfile | null>(() => (
    currentUserId
      ? {
          username: profile?.username ?? (user?.user_metadata?.username as string | undefined) ?? null,
          fullName: profile?.fullName ?? (user?.user_metadata?.full_name as string | undefined) ?? null,
          avatarUrl: profile?.avatarUrl ?? (user?.user_metadata?.avatar_url as string | undefined) ?? null,
        }
      : null
  ), [currentUserId, profile?.avatarUrl, profile?.fullName, profile?.username, user?.user_metadata]);

  const rebuildSnapshot = useCallback(() => {
    setSnapshot(normalizeTypingSnapshot(memberStatesRef.current.values(), currentUserId));
  }, [currentUserId]);

  const clearUserTimer = useCallback((userId: string) => {
    const timer = timersRef.current.get(userId);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(userId);
    }
  }, []);

  const scheduleRemoval = useCallback((userId: string) => {
    clearUserTimer(userId);
    const timer = setTimeout(() => {
      timersRef.current.delete(userId);
      memberStatesRef.current.delete(userId);
      rebuildSnapshot();
    }, TYPING_VISIBLE_TTL_MS);
    timersRef.current.set(userId, timer);
  }, [clearUserTimer, rebuildSnapshot]);

  const sendPresenceTyping = useCallback((state: RequestedTypingState) => {
    if (!subscriptionRef.current || !currentUserProfile) return;
    const context: PresenceTypingContext | null = state?.isTyping
      ? {
          scope: "task_comment",
          parentCommentId: state.parentCommentId ?? null,
        }
      : null;
    subscriptionRef.current.send({
      type: "typing",
      isTyping: state?.isTyping ?? false,
      profile: currentUserProfile,
      context,
    });
  }, [currentUserProfile]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (isVisible) return;
    if (requestedTypingStateRef.current?.isTyping) {
      requestedTypingStateRef.current = { isTyping: false, parentCommentId: null };
      sendPresenceTyping(requestedTypingStateRef.current);
    }
    memberStatesRef.current.clear();
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
    rebuildSnapshot();
  }, [isVisible, rebuildSnapshot, sendPresenceTyping]);

  useEffect(() => {
    if (!enabled || !taskId || !currentUserId) {
      requestedTypingStateRef.current = null;
      memberStatesRef.current.clear();
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
      setSnapshot({ topLevel: [], repliesByParentId: {} });
      setStatus("disconnected");
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
      return;
    }

    const subscription = subscribePresenceRoom({
      roomType: "task",
      roomId: taskId,
      role: "viewer",
      onStatus: (nextStatus) => {
        setStatus(nextStatus);
        if (nextStatus === "connected" && requestedTypingStateRef.current?.isTyping) {
          sendPresenceTyping(requestedTypingStateRef.current);
        }
      },
      onEvent: (event) => {
        if (event.type === "presence.state") {
          memberStatesRef.current = new Map(event.members.map((member) => [member.userId, member]));
          timersRef.current.forEach(clearTimeout);
          timersRef.current.clear();
          for (const member of event.members) {
            if (member.typing && member.userId !== currentUserId) {
              scheduleRemoval(member.userId);
            }
          }
          rebuildSnapshot();
          return;
        }

        if (event.type !== "presence.delta") return;

        if (event.action === "leave" || !event.member.typing) {
          memberStatesRef.current.delete(event.member.userId);
          clearUserTimer(event.member.userId);
          rebuildSnapshot();
          return;
        }

        memberStatesRef.current.set(event.member.userId, event.member);
        scheduleRemoval(event.member.userId);
        rebuildSnapshot();
      },
    });

    subscriptionRef.current = subscription;

    return () => {
      if (requestedTypingStateRef.current?.isTyping) {
        subscription.send({
          type: "typing",
          isTyping: false,
          profile: currentUserProfile,
          context: null,
        });
      }
      requestedTypingStateRef.current = null;
      subscription.unsubscribe();
      subscriptionRef.current = null;
      memberStatesRef.current.clear();
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
      setSnapshot({ topLevel: [], repliesByParentId: {} });
      setStatus("disconnected");
    };
  }, [
    clearUserTimer,
    currentUserId,
    currentUserProfile,
    enabled,
    rebuildSnapshot,
    scheduleRemoval,
    sendPresenceTyping,
    taskId,
  ]);

  const sendTyping = useCallback(async (params: SendTypingParams) => {
    if (!enabled || !taskId || !isVisible) return;
    if (!currentUserProfile) return;

    if (params.isTyping) {
      const now = Date.now();
      if (now - lastBroadcastRef.current < 500) return;
      lastBroadcastRef.current = now;
    }

    requestedTypingStateRef.current = {
      isTyping: params.isTyping,
      parentCommentId: params.parentCommentId ?? null,
    };
    sendPresenceTyping(requestedTypingStateRef.current);
  }, [currentUserProfile, enabled, isVisible, sendPresenceTyping, taskId]);

  return {
    topLevelTypingUsers: snapshot.topLevel,
    replyTypingUsersByParentId: snapshot.repliesByParentId,
    presenceStatus: status,
    sendTyping,
  };
}
