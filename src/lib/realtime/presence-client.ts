"use client";

import {
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
} from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import type {
  PresenceClientEvent,
  PresenceMemberState,
  PresenceRoomRole,
  PresenceRoomType,
  PresenceServerEvent,
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
  const disconnectedRoomCount = activeEntries.filter((entry) => entry.status !== "connected").length;
  const degraded = activeEntries.length > 0 && disconnectedRoomCount > 0;
  return {
    status: activeEntries.length === 0 || connectedRoomCount > 0 ? "healthy" : "unavailable",
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

async function resolveCurrentUserId(entry: PresenceRoomEntry, event?: PresenceClientEvent) {
  if (event?.type === "typing" && event.userId) return event.userId;
  if (entry.roomType === "user" && entry.role === "editor") return entry.roomId;
  if (entry.lastTrackedUserId) return entry.lastTrackedUserId;

  const { data } = await createClient().auth.getUser();
  return data.user?.id ?? null;
}

async function trackPresence(entry: PresenceRoomEntry, event?: PresenceClientEvent) {
  if (!entry.channel || entry.status !== "connected") return;
  const userId = await resolveCurrentUserId(entry, event);
  if (!userId) return;

  entry.lastTrackedUserId = userId;
  const typingEvent = event?.type === "typing" ? event : null;
  await entry.channel.track({
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
  });
}

function createEntry(roomType: PresenceRoomType, roomId: string, role: PresenceRoomRole) {
  const supabase = createClient();
  const connectionId = createConnectionId();
  const channel = supabase
    .channel(getRoomTopic(roomType, roomId), {
      config: { presence: { key: connectionId } },
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
    });

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
  };

  presenceEntries.set(getRoomKey(roomType, roomId), entry);
  emitHealthSnapshot();

  channel.subscribe((status: RealtimeSubscribeStatus) => {
    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
      updateStatus(entry, "connected");
      if (role === "editor" || roomType === "user") {
        void trackPresence(entry);
      }
      return;
    }

    if (
      status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
      status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
    ) {
      updateStatus(entry, "error");
      return;
    }

    if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) {
      updateStatus(entry, "disconnected");
    }
  });

  return entry;
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
      if (event.type === "typing" || event.type === "cursor") {
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
