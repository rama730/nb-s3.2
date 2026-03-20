"use client";

import { logger } from "@/lib/logger";
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
const LOCAL_PRESENCE_FALLBACK_URL = "ws://127.0.0.1:4010/ws";
const presenceEntries = new Map<string, PresenceRoomEntry>();

function getRoomKey(roomType: PresenceRoomType, roomId: string) {
  return `${roomType}:${roomId}`;
}

function notifyStatus(entry: PresenceRoomEntry, status: PresenceStatus) {
  for (const listener of entry.statusListeners) {
    listener(status);
  }
}

function broadcastEvent(entry: PresenceRoomEntry, event: PresenceServerEvent) {
  for (const listener of entry.listeners) {
    listener(event);
  }
}

function resolvePresenceWsUrl(preferredUrl?: string | null) {
  if (preferredUrl && preferredUrl.trim().length > 0) {
    return preferredUrl.trim().replace(/\/$/, "");
  }

  const configured = process.env.NEXT_PUBLIC_PRESENCE_WS_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return LOCAL_PRESENCE_FALLBACK_URL.replace(/^ws:/, protocol);
    }
  }

  return null;
}

async function fetchPresenceToken(entry: PresenceRoomEntry) {
  const response = await fetch("/api/realtime/presence-token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify({
      roomType: entry.roomType,
      roomId: entry.roomId,
      role: entry.role,
    }),
  });

  const body = await response.json().catch(() => null) as (TokenResponse & { error?: string }) | null;
  if (!response.ok || !body?.ok || !body.data?.token) {
    const retryable = response.status === 429 || response.status >= 500;
    const message = body?.error || `Presence token request failed (${response.status})`;
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

  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }
  if (entry.heartbeatTimer) {
    clearInterval(entry.heartbeatTimer);
    entry.heartbeatTimer = null;
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

  if (event.type === "heartbeat") {
    return;
  }

  entry.pendingEvents.push(event);
  if (entry.pendingEvents.length > 4) {
    entry.pendingEvents.splice(0, entry.pendingEvents.length - 4);
  }
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
    const token = await fetchPresenceToken(entry);
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
      entry.heartbeatTimer = setInterval(() => {
        sendPresenceEvent(entry, { type: "heartbeat" });
      }, HEARTBEAT_INTERVAL_MS);

      logger.metric("presence.room.connected", {
        roomType: entry.roomType,
        roomId: entry.roomId,
        value: 1,
      });
    };

    socket.onmessage = (message) => {
      try {
        const parsed = JSON.parse(String(message.data)) as PresenceServerEvent;
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

    socket.onclose = () => {
      if (entry.heartbeatTimer) {
        clearInterval(entry.heartbeatTimer);
        entry.heartbeatTimer = null;
      }
      entry.socket = null;
      scheduleReconnect(entry, true);
    };
  } catch (error) {
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
  }
}

function ensureEntry(roomType: PresenceRoomType, roomId: string, role: PresenceRoomRole) {
  const roomKey = getRoomKey(roomType, roomId);
  const existing = presenceEntries.get(roomKey);
  if (existing) {
    if (role === "editor") {
      existing.role = "editor";
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
        cleanupEntry(getRoomKey(entry.roomType, entry.roomId));
      }
    },
  };
}
