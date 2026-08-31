"use client";

import {
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
} from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { isPrivateRealtimeAuthorizationEnabled } from "./authorization";
import type {
  PresenceClientEvent,
  PresenceMemberState,
  PresenceMemberProfile,
  PresenceRoomRole,
  PresenceRoomType,
  PresenceServerEvent,
  PresenceTypingContext,
} from "./presence-types";

export type PresenceStatus = "connecting" | "connected" | "disconnected" | "error";
type PresenceListener = (event: PresenceServerEvent) => void;
type PresenceStatusListener = (status: PresenceStatus) => void;
type PresenceHealthListener = () => void;

export type PresenceHealthSnapshot = {
  status: "healthy" | "degraded" | "unavailable";
  degraded: boolean;
  activeRoomCount: number;
  connectedRoomCount: number;
  disconnectedRoomCount: number;
  circuitOpenUntilMs: null;
  lastError: string | null;
};

type PresenceRoomEntry = {
  roomType: PresenceRoomType;
  roomId: string;
  role: PresenceRoomRole;
  connectionId: string;
  channel: RealtimeChannel;
  listeners: Set<PresenceListener>;
  statusListeners: Set<PresenceStatusListener>;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  status: PresenceStatus;
  latestStateEvent: Extract<PresenceServerEvent, { type: "presence.state" }> | null;
  lastTrackedUserId: string | null;
  _lastTrackTime?: number;
  _pendingTrackTimer?: ReturnType<typeof setTimeout> | null;
  failureReported: boolean;
};

type SupabasePresenceMeta = Partial<PresenceMemberState> & {
  presence_ref?: string;
  phx_ref?: string;
};
type SupabasePresenceJoinPayload = {
  key: string;
  newPresences: SupabasePresenceMeta[];
};
type SupabasePresenceLeavePayload = {
  key: string;
  leftPresences: SupabasePresenceMeta[];
};
type TypingBroadcastPayload = {
  connectionId: string;
  userId: string;
  typing: boolean;
  typingContext: PresenceTypingContext | null;
  userName: string | null;
  profile: PresenceMemberProfile | null;
};
type RealtimeSubscribeStatus =
  (typeof REALTIME_SUBSCRIBE_STATES)[keyof typeof REALTIME_SUBSCRIBE_STATES];

const ENTRY_RELEASE_GRACE_MS = 1_500;
const presenceEntries = new Map<string, PresenceRoomEntry>();
const presenceHealthListeners = new Set<PresenceHealthListener>();

function createConnectionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getRoomKey(roomType: PresenceRoomType, roomId: string) {
  return `${roomType}:${roomId}`;
}

function getRoomTopic(roomType: PresenceRoomType, roomId: string) {
  return `presence:${roomType}:${roomId}`;
}

function computePresenceHealthSnapshot(): PresenceHealthSnapshot {
  const activeEntries = Array.from(presenceEntries.values()).filter(
    (entry) => entry.listeners.size > 0 || entry.statusListeners.size > 0,
  );
  const connectedRoomCount = activeEntries.filter((entry) => entry.status === "connected").length;
  const disconnectedRoomCount = activeEntries.filter((entry) => entry.status === "disconnected" || entry.status === "error").length;

  const status = activeEntries.length > 0 && disconnectedRoomCount === activeEntries.length
    ? "unavailable"
    : disconnectedRoomCount > 0
      ? "degraded"
      : "healthy";
  const degraded = status !== "healthy";

  return {
    status,
    degraded,
    activeRoomCount: activeEntries.length,
    connectedRoomCount,
    disconnectedRoomCount,
    circuitOpenUntilMs: null,
    lastError: degraded ? "Supabase Realtime presence channel disconnected" : null,
  };
}

let presenceHealthSnapshot = computePresenceHealthSnapshot();

function emitHealthSnapshot() {
  const nextSnapshot = computePresenceHealthSnapshot();
  if (
    nextSnapshot.status === presenceHealthSnapshot.status &&
    nextSnapshot.degraded === presenceHealthSnapshot.degraded &&
    nextSnapshot.activeRoomCount === presenceHealthSnapshot.activeRoomCount &&
    nextSnapshot.connectedRoomCount === presenceHealthSnapshot.connectedRoomCount &&
    nextSnapshot.disconnectedRoomCount === presenceHealthSnapshot.disconnectedRoomCount &&
    nextSnapshot.lastError === presenceHealthSnapshot.lastError
  ) {
    return;
  }

  presenceHealthSnapshot = nextSnapshot;
  for (const listener of Array.from(presenceHealthListeners)) {
    listener();
  }
}

function updateStatus(entry: PresenceRoomEntry, status: PresenceStatus) {
  if (entry.status === status) return;
  entry.status = status;
  for (const listener of Array.from(entry.statusListeners)) {
    listener(status);
  }
  emitHealthSnapshot();
}

function toPresenceMember(
  entry: PresenceRoomEntry,
  raw: SupabasePresenceMeta,
  fallbackKey: string,
): PresenceMemberState {
  return {
    connectionId: String(raw.connectionId ?? raw.presence_ref ?? raw.phx_ref ?? fallbackKey),
    userId: String(raw.userId ?? fallbackKey),
    roomType: entry.roomType,
    roomId: entry.roomId,
    role: (raw.role as PresenceRoomRole | undefined) ?? entry.role,
    lastSeenAt: typeof raw.lastSeenAt === "number" ? raw.lastSeenAt : Date.now(),
    cursorFrame: typeof raw.cursorFrame === "string" ? raw.cursorFrame : null,
    typing: Boolean(raw.typing),
    typingContext: raw.typingContext ?? null,
    userName: typeof raw.userName === "string" ? raw.userName : null,
    profile: raw.profile ?? null,
  };
}

function flattenPresenceState(entry: PresenceRoomEntry): PresenceMemberState[] {
  const state = entry.channel.presenceState() as Record<string, SupabasePresenceMeta[]>;
  const members: PresenceMemberState[] = [];
  for (const [key, metas] of Object.entries(state)) {
    for (const meta of metas) {
      members.push(toPresenceMember(entry, meta, key));
    }
  }
  return members;
}

function emitPresenceState(entry: PresenceRoomEntry) {
  const stateEvent: Extract<PresenceServerEvent, { type: "presence.state" }> = {
    type: "presence.state",
    roomType: entry.roomType,
    roomId: entry.roomId,
    members: flattenPresenceState(entry),
  };
  entry.latestStateEvent = stateEvent;
  for (const listener of Array.from(entry.listeners)) {
    listener(stateEvent);
  }
}

function emitPresenceDelta(
  entry: PresenceRoomEntry,
  action: "upsert" | "leave",
  key: string,
  presences: SupabasePresenceMeta[],
) {
  for (const presence of presences) {
    const event: Extract<PresenceServerEvent, { type: "presence.delta" }> = {
      type: "presence.delta",
      action,
      roomType: entry.roomType,
      roomId: entry.roomId,
      member: toPresenceMember(entry, presence, key),
    };
    for (const listener of Array.from(entry.listeners)) {
      listener(event);
    }
  }
}

async function resolveCurrentUserId(entry: PresenceRoomEntry) {
  if (entry.lastTrackedUserId) return entry.lastTrackedUserId;

  const { data } = await createClient().auth.getUser();
  return data.user?.id ?? null;
}

function canPublishToPresenceRoom(entry: PresenceRoomEntry, userId: string) {
  // Per-user rooms have one publisher: the room owner. Other clients may
  // observe an authorized peer, but must never add their own presence state
  // to that peer's room. Shared rooms publish participant presence normally.
  return entry.roomType !== "user" || entry.roomId === userId;
}

async function trackPresence(entry: PresenceRoomEntry, event?: PresenceClientEvent) {
  if (!entry.channel || entry.status !== "connected") return;
  const userId = await resolveCurrentUserId(entry);
  if (!userId || !canPublishToPresenceRoom(entry, userId)) return;

  entry.lastTrackedUserId = userId;
  const typingEvent = event?.type === "typing" ? event : null;

  const payload = {
      connectionId: entry.connectionId,
      userId,
      roomType: entry.roomType,
      roomId: entry.roomId,
      role: entry.role,
      lastSeenAt: Date.now(),
      cursorFrame: event?.type === "cursor" ? event.frame : null,
      typing: typingEvent?.isTyping ?? false,
      typingContext: typingEvent?.context ?? null,
      userName: event?.type === "cursor" ? event.userName ?? null : null,
      profile: typingEvent?.profile ?? null,
  };

  const executeTrack = async (data: typeof payload) => {
      try {
          await entry.channel.track(data);
      } catch (error) {
          console.debug("[presence-client] failed to track presence", error);
      }
  };

  const now = Date.now();
  const MIN_TRACK_INTERVAL_MS = 2500;

  if (!entry._lastTrackTime) {
      entry._lastTrackTime = 0;
  }

  const timeSinceLastTrack = now - entry._lastTrackTime;

  if (timeSinceLastTrack < MIN_TRACK_INTERVAL_MS) {
      if (entry._pendingTrackTimer) clearTimeout(entry._pendingTrackTimer);
      entry._pendingTrackTimer = setTimeout(() => {
          entry._lastTrackTime = Date.now();
          void executeTrack(payload);
      }, MIN_TRACK_INTERVAL_MS - timeSinceLastTrack);
      return;
  }

  entry._lastTrackTime = now;
  if (entry._pendingTrackTimer) {
      clearTimeout(entry._pendingTrackTimer);
      entry._pendingTrackTimer = null;
  }
  void executeTrack(payload);
}

async function broadcastTyping(entry: PresenceRoomEntry, event: PresenceClientEvent) {
  if (!entry.channel || entry.status !== "connected" || event.type !== "typing") return;
  const userId = await resolveCurrentUserId(entry);
  if (!userId || !canPublishToPresenceRoom(entry, userId)) return;

  const payload = {
      connectionId: entry.connectionId,
      userId,
      typing: event.isTyping,
      typingContext: event.context,
      userName: null,
      profile: event.profile,
  };

  try {
      await entry.channel.send({
          type: "broadcast",
          event: "typing",
          payload,
      });
  } catch (error) {
      console.debug("[presence-client] failed to broadcast typing", error);
  }
}

function setupChannel(roomType: PresenceRoomType, roomId: string, connectionId: string) {
  const supabase = createClient();
  return supabase
    .channel(getRoomTopic(roomType, roomId), {
      config: { private: true, presence: { key: connectionId } },
    })
    .on("presence", { event: "sync" }, () => {
      const entry = presenceEntries.get(getRoomKey(roomType, roomId));
      if (!entry) return;
      emitPresenceState(entry);
    })
    .on("presence", { event: "join" }, ({ key, newPresences }: SupabasePresenceJoinPayload) => {
      const entry = presenceEntries.get(getRoomKey(roomType, roomId));
      if (!entry) return;
      emitPresenceDelta(entry, "upsert", String(key), newPresences);
    })
    .on("presence", { event: "leave" }, ({ key, leftPresences }: SupabasePresenceLeavePayload) => {
      const entry = presenceEntries.get(getRoomKey(roomType, roomId));
      if (!entry) return;
      emitPresenceDelta(entry, "leave", String(key), leftPresences);
    })
    .on("broadcast", { event: "typing" }, ({ payload }: { payload: TypingBroadcastPayload }) => {
      const entry = presenceEntries.get(getRoomKey(roomType, roomId));
      if (!entry || !payload) return;
      const authenticatedMember = flattenPresenceState(entry).find((member) =>
        member.connectionId === String(payload.connectionId)
        && member.userId === String(payload.userId),
      );
      if (!authenticatedMember) return;

      const memberEvent: PresenceServerEvent = {
        type: "presence.delta",
        action: payload.typing ? "upsert" : "leave",
        roomType: entry.roomType,
        roomId: entry.roomId,
        member: {
            connectionId: String(payload.connectionId),
            userId: String(payload.userId),
            roomType: entry.roomType,
            roomId: entry.roomId,
            role: "viewer",
            lastSeenAt: Date.now(),
            cursorFrame: null,
            typing: payload.typing,
            typingContext: payload.typingContext ?? null,
            userName: payload.userName ?? null,
            profile: authenticatedMember.profile ?? null,
        }
      };

      for (const listener of Array.from(entry.listeners)) {
          listener(memberEvent);
      }
    });
}

function createEntry(roomType: PresenceRoomType, roomId: string, role: PresenceRoomRole) {
  const connectionId = createConnectionId();
  const channel = setupChannel(roomType, roomId, connectionId);

  const entry: PresenceRoomEntry = {
    roomType,
    roomId,
    role,
    connectionId,
    channel,
    listeners: new Set(),
    statusListeners: new Set(),
    releaseTimer: null,
    status: "connecting",
    latestStateEvent: null,
    lastTrackedUserId: null,
    failureReported: false,
  };

  presenceEntries.set(getRoomKey(roomType, roomId), entry);
  emitHealthSnapshot();

  void connectEntry(entry);
  return entry;
}

async function connectEntry(entry: PresenceRoomEntry) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getSession();
  if (presenceEntries.get(getRoomKey(entry.roomType, entry.roomId)) !== entry) return;
  const accessToken = data.session?.access_token;

  if (error || !accessToken) {
    updateStatus(entry, "error");
    return;
  }

  try {
    await supabase.realtime.setAuth(accessToken);
  } catch (authError) {
    if (presenceEntries.get(getRoomKey(entry.roomType, entry.roomId)) !== entry) return;
    if (!entry.failureReported) {
      entry.failureReported = true;
      console.warn("[presence-client] failed to authorize Realtime", {
        roomType: entry.roomType,
        roomId: entry.roomId,
        error: authError instanceof Error ? authError.message : String(authError),
      });
    }
    updateStatus(entry, "error");
    return;
  }

  if (presenceEntries.get(getRoomKey(entry.roomType, entry.roomId)) !== entry) return;

  entry.channel.subscribe((status: RealtimeSubscribeStatus, subError?: Error) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        entry.failureReported = false;
        updateStatus(entry, "connected");
        void trackPresence(entry);
        return;
      }

      if (
        status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
        status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
      ) {
        if (!entry.failureReported) {
          entry.failureReported = true;
          console.warn("[presence-client] private channel unavailable", {
            roomType: entry.roomType,
            roomId: entry.roomId,
            status,
            state: entry.channel.state,
            error: subError?.message ?? null,
          });
        }
        updateStatus(entry, "error");
        if (subError?.message.includes("Unauthorized")) {
          void supabase.removeChannel(entry.channel);
        }
        return;
      }

      if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) {
        updateStatus(entry, "disconnected");
      }
  });
}

function ensureEntry(roomType: PresenceRoomType, roomId: string, role: PresenceRoomRole) {
  const roomKey = getRoomKey(roomType, roomId);
  const existing = presenceEntries.get(roomKey);
  if (existing) {
    if (existing.releaseTimer) {
      clearTimeout(existing.releaseTimer);
      existing.releaseTimer = null;
    }
    return existing;
  }
  return createEntry(roomType, roomId, role);
}

function cleanupEntry(roomKey: string) {
  const entry = presenceEntries.get(roomKey);
  if (!entry) return;
  if (entry.releaseTimer) {
    clearTimeout(entry.releaseTimer);
  }
  if (entry._pendingTrackTimer) {
    clearTimeout(entry._pendingTrackTimer);
  }
  presenceEntries.delete(roomKey);
  createClient().removeChannel(entry.channel);
  emitHealthSnapshot();
}

export function subscribePresenceRoom(params: {
  roomType: PresenceRoomType;
  roomId: string;
  role?: PresenceRoomRole;
  onEvent?: PresenceListener;
  onStatus?: PresenceStatusListener;
}) {
  if (!isPrivateRealtimeAuthorizationEnabled()) {
    params.onStatus?.("disconnected");
    return {
      send(_event: PresenceClientEvent) {
        // Fail closed until private Realtime policies are deployed and verified.
      },
      unsubscribe() {
        // No channel was opened.
      },
    };
  }

  const entry = ensureEntry(params.roomType, params.roomId, params.role ?? "viewer");
  if (params.onEvent) {
    entry.listeners.add(params.onEvent);
  }
  if (params.onStatus) {
    entry.statusListeners.add(params.onStatus);
  }

  params.onStatus?.(entry.status);
  if (params.onEvent && entry.latestStateEvent) {
    params.onEvent(entry.latestStateEvent);
  }

  return {
    send(event: PresenceClientEvent) {
      if (event.type === "typing") {
        void broadcastTyping(entry, event);
      } else if (event.type === "cursor") {
        void trackPresence(entry, event);
      }
    },
    unsubscribe() {
      if (params.onEvent) {
        entry.listeners.delete(params.onEvent);
      }
      if (params.onStatus) {
        entry.statusListeners.delete(params.onStatus);
      }
      if (entry.listeners.size === 0 && entry.statusListeners.size === 0) {
        if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
        const roomKey = getRoomKey(entry.roomType, entry.roomId);
        entry.releaseTimer = setTimeout(() => cleanupEntry(roomKey), ENTRY_RELEASE_GRACE_MS);
      }
    },
  };
}

export function getPresenceHealthSnapshot() {
  return presenceHealthSnapshot;
}

export function subscribePresenceHealth(listener: PresenceHealthListener) {
  presenceHealthListeners.add(listener);
  return () => {
    presenceHealthListeners.delete(listener);
  };
}

export function getPresenceRoomCountForTests() {
  return presenceEntries.size;
}

export function resetPresenceClientForTests() {
  for (const roomKey of Array.from(presenceEntries.keys())) {
    cleanupEntry(roomKey);
  }
  presenceHealthSnapshot = computePresenceHealthSnapshot();
  presenceHealthListeners.clear();
}
