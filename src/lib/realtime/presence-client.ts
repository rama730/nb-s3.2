"use client";

import { logger } from "@/lib/logger";
import { resolvePresenceWebSocketUrl } from "@/lib/realtime/presence-config";
import {
  advancePresenceCircuitState,
  computePresenceReconnectDelayMs,
  INITIAL_PRESENCE_CIRCUIT_STATE,
  isPresenceCircuitOpen,
  type PresenceCircuitState,
} from "@/lib/realtime/presence-health";
import type {
  PresenceClientEvent,
  PresenceRoomRole,
  PresenceRoomType,
  PresenceServerEvent,
} from "./presence-types";

export type PresenceStatus = "connecting" | "connected" | "disconnected" | "error";
type PresenceListener = (event: PresenceServerEvent) => void;
type PresenceStatusListener = (status: PresenceStatus) => void;
type PresenceHealthListener = () => void;

type TokenResponse = {
  ok?: boolean;
  error?: string;
  data?: {
    token?: string | null;
    wsUrl?: string | null;
    disabled?: boolean;
  };
};

type PresenceRoomEntry = {
  roomType: PresenceRoomType;
  roomId: string;
  role: PresenceRoomRole;
  socket: WebSocket | null;
  listeners: Set<PresenceListener>;
  statusListeners: Set<PresenceStatusListener>;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  connectPromise: Promise<void> | null;
  tokenRequestController: AbortController | null;
  pendingEvents: PresenceClientEvent[];
  latestWsUrl: string | null;
  authenticated: boolean;
  status: PresenceStatus;
  latestStateEvent: Extract<PresenceServerEvent, { type: "presence.state" }> | null;
};

export type PresenceHealthSnapshot = {
  status: "healthy" | "degraded" | "unavailable";
  degraded: boolean;
  activeRoomCount: number;
  connectedRoomCount: number;
  disconnectedRoomCount: number;
  circuitOpenUntilMs: number | null;
  lastError: string | null;
};

class PresenceConnectError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "PresenceConnectError";
    this.retryable = retryable;
  }
}

const HEARTBEAT_INTERVAL_MS = 20_000;
const ENTRY_RELEASE_GRACE_MS = 1_500;
const presenceEntries = new Map<string, PresenceRoomEntry>();
const presenceHealthListeners = new Set<PresenceHealthListener>();
const utf8Decoder = new TextDecoder();
let presenceCircuitState: PresenceCircuitState = INITIAL_PRESENCE_CIRCUIT_STATE;
let presenceUnavailableReason: string | null = null;
let presenceHealthSnapshot: PresenceHealthSnapshot = {
  status: "healthy",
  degraded: false,
  activeRoomCount: 0,
  connectedRoomCount: 0,
  disconnectedRoomCount: 0,
  circuitOpenUntilMs: null,
  lastError: null,
};

export function isPresenceTokenRequestRetryable(status: number, message?: string | null) {
  const normalizedMessage = (message || "").toLowerCase();
  if (
    normalizedMessage.includes("not configured")
    || normalizedMessage.includes("required to issue presence room tokens")
  ) {
    return false;
  }

  return status === 429 || status >= 500;
}

export function enqueuePendingPresenceEvent(
  queue: PresenceClientEvent[],
  event: PresenceClientEvent,
  limit = 4,
) {
  if (event.type === "heartbeat") {
    return queue;
  }

  if (event.type === "typing" || event.type === "cursor") {
    const nextQueue = queue.filter((queuedEvent) => queuedEvent.type !== event.type);
    nextQueue.push(event);
    if (nextQueue.length > limit) {
      nextQueue.splice(0, nextQueue.length - limit);
    }
    return nextQueue;
  }

  // Wave 2 Step 11: delivered/read events carry batched messageIds. If we
  // have a pending queued event of the same type, merge IDs into it rather
  // than stacking two separate sends. This keeps the queue compact even when
  // flushing while the socket is reconnecting.
  if (event.type === "delivered" || event.type === "read") {
    const existingIndex = queue.findIndex((queuedEvent) => queuedEvent.type === event.type);
    if (existingIndex >= 0) {
      const existing = queue[existingIndex] as typeof event;
      const merged = {
        ...existing,
        messageIds: Array.from(new Set([...existing.messageIds, ...event.messageIds])),
      };
      const nextQueue = [...queue];
      nextQueue[existingIndex] = merged;
      return nextQueue;
    }
    const nextQueue = [...queue, event];
    if (nextQueue.length > limit) {
      nextQueue.splice(0, nextQueue.length - limit);
    }
    return nextQueue;
  }

  const nextQueue = [...queue, event];
  if (nextQueue.length > limit) {
    nextQueue.splice(0, nextQueue.length - limit);
  }
  return nextQueue;
}

function getRoomKey(roomType: PresenceRoomType, roomId: string) {
  return `${roomType}:${roomId}`;
}

function computePresenceHealthSnapshot(): PresenceHealthSnapshot {
  const activeEntries = Array.from(presenceEntries.values()).filter(
    (entry) => entry.listeners.size > 0 || entry.statusListeners.size > 0,
  );
  const connectedRoomCount = activeEntries.filter((entry) => entry.status === "connected").length;
  const disconnectedRoomCount = activeEntries.filter(
    (entry) => entry.status === "disconnected" || entry.status === "error",
  ).length;
  const circuitOpenUntilMs = isPresenceCircuitOpen(presenceCircuitState)
    ? presenceCircuitState.openUntilMs
    : null;
  const lastError = presenceUnavailableReason ?? presenceCircuitState.lastError;
  const status: PresenceHealthSnapshot["status"] = presenceUnavailableReason
    ? "unavailable"
    : (disconnectedRoomCount > 0 || Boolean(circuitOpenUntilMs))
      ? "degraded"
      : "healthy";

  return {
    status,
    degraded: status !== "healthy",
    activeRoomCount: activeEntries.length,
    connectedRoomCount,
    disconnectedRoomCount,
    circuitOpenUntilMs,
    lastError,
  };
}

function emitPresenceHealth() {
  const nextSnapshot = computePresenceHealthSnapshot();
  const currentSnapshot = presenceHealthSnapshot;
  if (
    currentSnapshot.status === nextSnapshot.status
    && currentSnapshot.degraded === nextSnapshot.degraded
    && currentSnapshot.activeRoomCount === nextSnapshot.activeRoomCount
    && currentSnapshot.connectedRoomCount === nextSnapshot.connectedRoomCount
    && currentSnapshot.disconnectedRoomCount === nextSnapshot.disconnectedRoomCount
    && currentSnapshot.circuitOpenUntilMs === nextSnapshot.circuitOpenUntilMs
    && currentSnapshot.lastError === nextSnapshot.lastError
  ) {
    return;
  }

  presenceHealthSnapshot = nextSnapshot;
  for (const listener of Array.from(presenceHealthListeners)) {
    try {
      listener();
    } catch (error) {
      logger.warn("presence.health.listener_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function markPresenceUnavailable(reason: string | null) {
  presenceUnavailableReason = reason;
  emitPresenceHealth();
}

function markPresenceConnectSuccess() {
  presenceUnavailableReason = null;
  presenceCircuitState = advancePresenceCircuitState(presenceCircuitState, { type: "success" });
  emitPresenceHealth();
}

function markPresenceConnectFailure(message: string | null, retryable: boolean) {
  presenceUnavailableReason = retryable ? null : (message ?? "Presence is unavailable.");
  presenceCircuitState = advancePresenceCircuitState(presenceCircuitState, {
    type: "failure",
    nowMs: Date.now(),
    retryable,
    errorMessage: message,
  });
  emitPresenceHealth();
}

function notifyStatus(entry: PresenceRoomEntry, status: PresenceStatus) {
  entry.status = status;
  emitPresenceHealth();
  for (const listener of Array.from(entry.statusListeners)) {
    try {
      listener(status);
    } catch (error) {
      logger.warn("presence.room.status_listener_failed", {
        roomType: entry.roomType,
        roomId: entry.roomId,
        status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function broadcastEvent(entry: PresenceRoomEntry, event: PresenceServerEvent) {
  if (event.type === "presence.state") {
    entry.latestStateEvent = event;
  } else if (event.type === "presence.delta" && entry.latestStateEvent) {
    const nextMembers = [...entry.latestStateEvent.members];
    const memberIndex = nextMembers.findIndex(
      (member) => member.connectionId === event.member.connectionId,
    );
    if (event.action === "leave") {
      if (memberIndex >= 0) {
        nextMembers.splice(memberIndex, 1);
      }
    } else if (memberIndex >= 0) {
      nextMembers[memberIndex] = event.member;
    } else {
      nextMembers.push(event.member);
    }

    entry.latestStateEvent = {
      ...entry.latestStateEvent,
      roomType: event.roomType,
      roomId: event.roomId,
      members: nextMembers,
    };
  }

  for (const listener of Array.from(entry.listeners)) {
    try {
      listener(event);
    } catch (error) {
      logger.warn("presence.room.event_listener_failed", {
        roomType: entry.roomType,
        roomId: entry.roomId,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function resolvePresenceWsUrl(preferredUrl?: string | null) {
  return resolvePresenceWebSocketUrl({
    preferredUrl,
    hostname: typeof window !== "undefined" ? window.location.hostname : null,
  });
}

async function decodePresenceMessageData(data: unknown) {
  if (typeof data === "string") {
    return data;
  }

  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return data.text();
  }

  if (data instanceof ArrayBuffer) {
    return utf8Decoder.decode(new Uint8Array(data));
  }

  if (ArrayBuffer.isView(data)) {
    return utf8Decoder.decode(data);
  }

  throw new Error(`Unsupported presence message data type: ${Object.prototype.toString.call(data)}`);
}

async function fetchPresenceToken(entry: PresenceRoomEntry, signal?: AbortSignal) {
  const response = await fetch("/api/realtime/presence-token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    credentials: "same-origin",
    signal,
    body: JSON.stringify({
      roomType: entry.roomType,
      roomId: entry.roomId,
      role: entry.role,
    }),
  });

  const body = await response.json().catch(() => null) as TokenResponse | null;
  if (body?.ok && body.data?.disabled) {
    entry.latestWsUrl = null;
    markPresenceUnavailable("Presence service is disabled for this environment.");
    return null;
  }

  if (!response.ok || !body?.ok || !body.data?.token) {
    const message = body?.error || `Presence token request failed (${response.status})`;
    const retryable = isPresenceTokenRequestRetryable(response.status, message);
    throw new PresenceConnectError(message, retryable);
  }

  const wsUrl = resolvePresenceWsUrl(body.data.wsUrl ?? null);
  if (!wsUrl) {
    throw new PresenceConnectError("Presence service URL is not configured for this environment.", false);
  }

  entry.latestWsUrl = wsUrl;
  return body.data.token;
}

function cleanupEntry(roomKey: string) {
  const entry = presenceEntries.get(roomKey);
  if (!entry) return;

  if (entry.releaseTimer) {
    clearTimeout(entry.releaseTimer);
    entry.releaseTimer = null;
  }
  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }
  if (entry.heartbeatTimer) {
    clearInterval(entry.heartbeatTimer);
    entry.heartbeatTimer = null;
  }
  if (entry.tokenRequestController) {
    entry.tokenRequestController.abort();
    entry.tokenRequestController = null;
  }
  if (entry.socket) {
    entry.socket.close();
    entry.socket = null;
  }

  presenceEntries.delete(roomKey);
  emitPresenceHealth();
}

function sendPresenceEvent(entry: PresenceRoomEntry, event: PresenceClientEvent) {
  if (entry.socket?.readyState === WebSocket.OPEN && entry.authenticated) {
    entry.socket.send(JSON.stringify(event));
    return;
  }

  entry.pendingEvents = enqueuePendingPresenceEvent(entry.pendingEvents, event);
}

function flushPendingEvents(entry: PresenceRoomEntry) {
  if (!entry.socket || entry.socket.readyState !== WebSocket.OPEN || entry.pendingEvents.length === 0) {
    return;
  }

  const pending = [...entry.pendingEvents];
  entry.pendingEvents.length = 0;
  for (const event of pending) {
    entry.socket.send(JSON.stringify(event));
  }
}

function scheduleReconnect(entry: PresenceRoomEntry, retryable = true) {
  if (entry.reconnectTimer || entry.listeners.size === 0) {
    return;
  }

  if (!retryable) {
    notifyStatus(entry, "error");
    return;
  }

  notifyStatus(entry, "disconnected");
  const delayMs = computePresenceReconnectDelayMs({
    attempt: entry.reconnectAttempts,
    nowMs: Date.now(),
    circuitOpenUntilMs: presenceCircuitState.openUntilMs,
    jitterMs: Math.floor(Math.random() * 250),
  });
  entry.reconnectTimer = setTimeout(() => {
    entry.reconnectTimer = null;
    if (entry.listeners.size === 0 && entry.statusListeners.size === 0) {
      return;
    }
    entry.reconnectAttempts += 1;
    void openPresenceRoom(entry);
  }, delayMs);

  logger.metric("presence.room.reconnect", {
    roomType: entry.roomType,
    roomId: entry.roomId,
    value: 1,
    attempt: entry.reconnectAttempts + 1,
  });
}

async function openPresenceRoom(entry: PresenceRoomEntry) {
  if (typeof window === "undefined") {
    return;
  }

  if (entry.releaseTimer) {
    clearTimeout(entry.releaseTimer);
    entry.releaseTimer = null;
  }

  if (
    entry.socket?.readyState === WebSocket.OPEN ||
    entry.socket?.readyState === WebSocket.CONNECTING
  ) {
    return;
  }

  if (entry.connectPromise) {
    return entry.connectPromise;
  }

  entry.connectPromise = (async () => {
    if (entry.socket) {
      entry.socket.close();
      entry.socket = null;
    }
    entry.authenticated = false;

    if (entry.heartbeatTimer) {
      clearInterval(entry.heartbeatTimer);
      entry.heartbeatTimer = null;
    }

    notifyStatus(entry, "connecting");

    try {
      const configuredWsUrl = resolvePresenceWsUrl();
      if (!configuredWsUrl) {
        markPresenceUnavailable("Presence service URL is not configured for this environment.");
        notifyStatus(entry, "disconnected");
        logger.metric("presence.room.disabled", {
          roomType: entry.roomType,
          roomId: entry.roomId,
          value: 1,
        });
        return;
      }

      if (isPresenceCircuitOpen(presenceCircuitState)) {
        throw new PresenceConnectError("Presence reconnect cooldown is active.", true);
      }

      const tokenRequestController = new AbortController();
      entry.tokenRequestController = tokenRequestController;
      const token = await fetchPresenceToken(entry, tokenRequestController.signal);
      if (!token) {
        notifyStatus(entry, "disconnected");
        return;
      }
      const baseWsUrl = entry.latestWsUrl;
      if (!baseWsUrl) {
        throw new PresenceConnectError("Presence service URL is unavailable.", false);
      }
      const socket = new WebSocket(baseWsUrl);
      entry.socket = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "auth", token }));
      };

      socket.onmessage = async (message) => {
        try {
          const raw = await decodePresenceMessageData(message.data);
          const parsed = JSON.parse(raw) as PresenceServerEvent;
          if (parsed.type === "ack" && parsed.ackType === "auth" && !entry.authenticated) {
            entry.authenticated = true;
            entry.reconnectAttempts = 0;
            markPresenceConnectSuccess();
            notifyStatus(entry, "connected");
            sendPresenceEvent(entry, { type: "heartbeat" });
            flushPendingEvents(entry);
            if (entry.heartbeatTimer) {
              clearInterval(entry.heartbeatTimer);
            }
            entry.heartbeatTimer = setInterval(() => {
              sendPresenceEvent(entry, { type: "heartbeat" });
            }, HEARTBEAT_INTERVAL_MS);
            logger.metric("presence.room.connected", {
              roomType: entry.roomType,
              roomId: entry.roomId,
              value: 1,
            });
          }
          broadcastEvent(entry, parsed);
        } catch (error) {
          logger.warn("presence.room.message_parse_failed", {
            roomType: entry.roomType,
            roomId: entry.roomId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      socket.onerror = () => {
        notifyStatus(entry, "error");
      };

      const activeSocket = socket;
      socket.onclose = () => {
        if (entry.socket !== activeSocket) {
          return;
        }
        if (entry.heartbeatTimer) {
          clearInterval(entry.heartbeatTimer);
          entry.heartbeatTimer = null;
        }
        entry.authenticated = false;
        entry.socket = null;
        scheduleReconnect(entry, true);
      };
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      if (aborted) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const retryable = !(error instanceof PresenceConnectError) || error.retryable;
      markPresenceConnectFailure(message, retryable);
      notifyStatus(entry, "error");
      logger.warn("presence.room.connect_failed", {
        roomType: entry.roomType,
        roomId: entry.roomId,
        error: message,
      });
      scheduleReconnect(entry, retryable);
    } finally {
      entry.tokenRequestController = null;
      entry.connectPromise = null;
    }
  })();

  return entry.connectPromise;
}

function ensureEntry(roomType: PresenceRoomType, roomId: string, role: PresenceRoomRole) {
  const roomKey = getRoomKey(roomType, roomId);
  const existing = presenceEntries.get(roomKey);
  if (existing) {
    if (existing.releaseTimer) {
      clearTimeout(existing.releaseTimer);
      existing.releaseTimer = null;
    }
    if (role === "editor") {
      existing.role = "editor";
    }
    if (!existing.socket && !existing.connectPromise && !existing.reconnectTimer) {
      void openPresenceRoom(existing);
    }
    return existing;
  }

  const entry: PresenceRoomEntry = {
    roomType,
    roomId,
    role,
    socket: null,
    listeners: new Set(),
    statusListeners: new Set(),
    reconnectAttempts: 0,
    reconnectTimer: null,
    heartbeatTimer: null,
    releaseTimer: null,
    connectPromise: null,
    tokenRequestController: null,
    pendingEvents: [],
    latestWsUrl: null,
    authenticated: false,
    status: "connecting",
    latestStateEvent: null,
  };
  presenceEntries.set(roomKey, entry);
  emitPresenceHealth();
  void openPresenceRoom(entry);
  return entry;
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

  if (params.onStatus) {
    params.onStatus(entry.status);
  }
  if (params.onEvent && entry.latestStateEvent) {
    params.onEvent(entry.latestStateEvent);
  }

  return {
    send(event: PresenceClientEvent) {
      sendPresenceEvent(entry, event);
    },
    unsubscribe() {
      if (params.onEvent) {
        entry.listeners.delete(params.onEvent);
      }
      if (params.onStatus) {
        entry.statusListeners.delete(params.onStatus);
      }
      if (entry.listeners.size === 0 && entry.statusListeners.size === 0) {
        if (entry.reconnectTimer) {
          clearTimeout(entry.reconnectTimer);
          entry.reconnectTimer = null;
        }
        if (entry.tokenRequestController) {
          entry.tokenRequestController.abort();
          entry.tokenRequestController = null;
        }
        const roomKey = getRoomKey(entry.roomType, entry.roomId);
        if (entry.releaseTimer) {
          clearTimeout(entry.releaseTimer);
        }
        entry.releaseTimer = setTimeout(() => {
          entry.releaseTimer = null;
          if (entry.listeners.size === 0 && entry.statusListeners.size === 0) {
            cleanupEntry(roomKey);
          }
        }, ENTRY_RELEASE_GRACE_MS);
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
  presenceCircuitState = INITIAL_PRESENCE_CIRCUIT_STATE;
  presenceUnavailableReason = null;
  presenceHealthSnapshot = computePresenceHealthSnapshot();
  presenceHealthListeners.clear();
}
