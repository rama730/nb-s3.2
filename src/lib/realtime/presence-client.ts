"use client";

import { logger } from "@/lib/logger";
import { resolvePresenceWebSocketUrl } from "@/lib/realtime/presence-config";
import type {
  PresenceClientEvent,
  PresenceRoomRole,
  PresenceRoomType,
  PresenceServerEvent,
} from "./presence-types";

type PresenceStatus = "connecting" | "connected" | "disconnected" | "error";
type PresenceListener = (event: PresenceServerEvent) => void;
type PresenceStatusListener = (status: PresenceStatus) => void;

type TokenResponse = {
  ok?: boolean;
  error?: string;
  data?: {
    token?: string;
    wsUrl?: string;
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
const utf8Decoder = new TextDecoder();

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

  const nextQueue = [...queue, event];
  if (nextQueue.length > limit) {
    nextQueue.splice(0, nextQueue.length - limit);
  }
  return nextQueue;
}

function getRoomKey(roomType: PresenceRoomType, roomId: string) {
  return `${roomType}:${roomId}`;
}

function notifyStatus(entry: PresenceRoomEntry, status: PresenceStatus) {
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
}

function sendPresenceEvent(entry: PresenceRoomEntry, event: PresenceClientEvent) {
  if (entry.socket?.readyState === WebSocket.OPEN) {
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
  const baseDelayMs = Math.min(10_000, 800 * Math.max(1, entry.reconnectAttempts + 1));
  const jitterMs = Math.floor(Math.random() * 250);
  const delayMs = baseDelayMs + jitterMs;
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

    if (entry.heartbeatTimer) {
      clearInterval(entry.heartbeatTimer);
      entry.heartbeatTimer = null;
    }

    notifyStatus(entry, "connecting");

    try {
      const tokenRequestController = new AbortController();
      entry.tokenRequestController = tokenRequestController;
      const token = await fetchPresenceToken(entry, tokenRequestController.signal);
      const baseWsUrl = entry.latestWsUrl;
      if (!baseWsUrl) {
        throw new PresenceConnectError("Presence service URL is unavailable.", false);
      }
      const wsUrl = `${baseWsUrl}?token=${encodeURIComponent(token)}`;
      const socket = new WebSocket(wsUrl);
      entry.socket = socket;

      socket.onopen = () => {
        entry.reconnectAttempts = 0;
        notifyStatus(entry, "connected");
        sendPresenceEvent(entry, { type: "heartbeat" });
        flushPendingEvents(entry);
        // H3: Clear existing heartbeat before creating new one to prevent leaks on reconnect
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
      };

      socket.onmessage = async (message) => {
        try {
          const raw = await decodePresenceMessageData(message.data);
          const parsed = JSON.parse(raw) as PresenceServerEvent;
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
        entry.socket = null;
        scheduleReconnect(entry, true);
      };
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      if (aborted) {
        return;
      }
      notifyStatus(entry, "error");
      logger.warn("presence.room.connect_failed", {
        roomType: entry.roomType,
        roomId: entry.roomId,
        error: error instanceof Error ? error.message : String(error),
      });
      scheduleReconnect(
        entry,
        !(error instanceof PresenceConnectError) || error.retryable,
      );
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
  };
  presenceEntries.set(roomKey, entry);
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

export function getPresenceRoomCountForTests() {
  return presenceEntries.size;
}

export function resetPresenceClientForTests() {
  for (const roomKey of Array.from(presenceEntries.keys())) {
    cleanupEntry(roomKey);
  }
}
