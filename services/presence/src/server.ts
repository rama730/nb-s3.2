import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";

import { recordOtlpMetric } from "../../../src/lib/telemetry/otlp";
import { verifyPresenceToken, type PresenceTokenClaims } from "../../../src/lib/realtime/presence-token";
import type {
  PresenceClientEvent,
  PresenceMemberProfile,
  PresenceMemberState,
  PresenceRoomType,
  PresenceServerEvent,
} from "../../../src/lib/realtime/presence-types";
import { createPresenceStore, type PresenceStore, type PresenceSubscriber } from "./store";

const PRESENCE_SERVICE_PORT = Number(process.env.PRESENCE_SERVICE_PORT || 4010);
const PRESENCE_TTL_SECONDS = 45;
const AUTH_TIMEOUT_MS = 5_000;
const MAX_RATE_LIMIT_VIOLATIONS = 8;
const EVENT_RATE_LIMITS = {
  heartbeat: {
    windowMs: 60_000,
    maxEvents: 6,
    minIntervalMs: 5_000,
  },
  cursor: {
    windowMs: 5_000,
    maxEvents: 120,
    minIntervalMs: 40,
  },
  typing: {
    windowMs: 5_000,
    maxEvents: 30,
    minIntervalMs: 250,
  },
} as const;
const authEventSchema = z.object({
  type: z.literal("auth"),
  token: z.string().trim().min(1).max(4096),
}).strict();
const cursorEventSchema = z.object({
  type: z.literal("cursor"),
  frame: z.string().max(1000).nullable().optional(),
  userName: z.string().max(100).nullable().optional(),
});
const presenceMemberProfileSchema = z.object({
  username: z.string().max(100).nullable(),
  fullName: z.string().max(200).nullable(),
  avatarUrl: z.string().max(2048).nullable(),
}).strict();
const typingEventSchema = z.object({
  type: z.literal("typing"),
  isTyping: z.boolean(),
  profile: presenceMemberProfileSchema.nullable().optional(),
});

type RoomKeys = {
  roomKey: string;
  memberHashKey: string;
  channelKey: string;
};

type RoomConnectionContext = {
  connectionId: string;
  claims: PresenceTokenClaims;
  roomKeys: RoomKeys;
  state: PresenceMemberState;
  rateState: Record<"heartbeat" | "cursor" | "typing", {
    timestamps: number[];
    lastAcceptedAt: number;
  }>;
  rateLimitViolations: number;
};

type LocalRoom = {
  roomKeys: RoomKeys;
  sockets: Set<WebSocket>;
  subscriber: PresenceSubscriber<PresenceServerEvent> | null;
  lastShatterCheck: number;
};

type PublishedPresenceServerEvent = PresenceServerEvent & {
  originServerId?: string;
};

const presenceStore = createPresenceStore();
const redis: PresenceStore = presenceStore.store;
const presenceServerInstanceId = randomUUID();

const rooms = new Map<string, LocalRoom>();
const socketContexts = new WeakMap<WebSocket, RoomConnectionContext>();

function emitMetric(name: string, payload: Record<string, unknown>) {
  recordOtlpMetric(name, payload);
  if (process.env.NODE_ENV !== "production") {
    console.info("[presence]", name, payload);
  }
}

function buildRoomKeys(claims: Pick<PresenceTokenClaims, "roomType" | "roomId">): RoomKeys {
  const roomKey = `${claims.roomType}:${claims.roomId}`;
  return {
    roomKey,
    memberHashKey: `presence:room:${roomKey}:members_v2`,
    channelKey: `presence:room:${roomKey}:events`,
  };
}

function toPresenceState(input: {
  claims: PresenceTokenClaims;
  connectionId: string;
  cursorFrame?: string | null;
  typing?: boolean;
  userName?: string | null;
  profile?: PresenceMemberProfile | null;
}) {
  return {
    connectionId: input.connectionId,
    userId: input.claims.userId,
    roomType: input.claims.roomType,
    roomId: input.claims.roomId,
    role: input.claims.role,
    lastSeenAt: Date.now(),
    cursorFrame: input.cursorFrame ?? null,
    typing: input.typing ?? false,
    userName: input.userName ?? null,
    profile: input.profile ?? null,
  } satisfies PresenceMemberState;
}

async function persistMemberState(context: RoomConnectionContext) {
  await redis.hset(context.roomKeys.memberHashKey, {
    [context.connectionId]: JSON.stringify(context.state),
  });
  await redis.expire(context.roomKeys.memberHashKey, PRESENCE_TTL_SECONDS * 2);
}

async function removeMemberState(context: RoomConnectionContext) {
  await redis.hdel(context.roomKeys.memberHashKey, context.connectionId);
}

async function readRoomMembers(roomKeys: RoomKeys) {
  const rawMembers = await redis.hgetall<Record<string, string>>(roomKeys.memberHashKey);
  if (!rawMembers) {
    return [] as PresenceMemberState[];
  }

  return Object.values(rawMembers)
    .map((raw) => {
      try {
        return JSON.parse(raw) as PresenceMemberState;
      } catch {
        return null;
      }
    })
    .filter((member): member is PresenceMemberState => Boolean(member));
}

function sendJson(socket: WebSocket, event: PresenceServerEvent) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(event));
}

function broadcastRoom(room: LocalRoom, event: PresenceServerEvent) {
  for (const socket of room.sockets) {
    sendJson(socket, event);
  }
}

function broadcastRoomLocally(roomKeys: RoomKeys, event: PresenceServerEvent) {
  const room = rooms.get(roomKeys.roomKey);
  if (!room) return;
  broadcastRoom(room, event);
}

async function publishPresenceEvent(roomKeys: RoomKeys, event: PresenceServerEvent) {
  const publishedEvent: PublishedPresenceServerEvent = {
    ...event,
    originServerId: presenceServerInstanceId,
  };
  await redis.publish(roomKeys.channelKey, JSON.stringify(publishedEvent));
}

async function ensureRoom(roomKeys: RoomKeys) {
  const existing = rooms.get(roomKeys.roomKey);
  if (existing) return existing;

  const room: LocalRoom = {
    roomKeys,
    sockets: new Set(),
    subscriber: null,
    lastShatterCheck: 0,
  };
  rooms.set(roomKeys.roomKey, room);

  const subscriber = redis.subscribe<PresenceServerEvent>(roomKeys.channelKey);
  room.subscriber = subscriber;
  subscriber.on("message", (event: { message?: PublishedPresenceServerEvent | string }) => {
    try {
      const payload = typeof event.message === "string"
        ? JSON.parse(event.message) as PublishedPresenceServerEvent
        : event.message;
      if (!payload) return;
      if (payload.originServerId === presenceServerInstanceId) {
        return;
      }
      broadcastRoom(room, payload);
    } catch (error) {
      console.warn("[presence] room subscriber message parse failed", {
        roomKey: roomKeys.roomKey,
        error: error instanceof Error ? error.message : String(error),
      });
      emitMetric("presence.room.subscriber_message_parse_failed", {
        roomKey: roomKeys.roomKey,
        value: 1,
      });
    }
  });
  subscriber.on("error", (error: Error) => {
    console.warn("[presence] room subscriber error", {
      roomKey: roomKeys.roomKey,
      error: error.message,
    });
    emitMetric("presence.room.subscriber_error", {
      roomKey: roomKeys.roomKey,
      value: 1,
    });
  });

  return room;
}

async function cleanupRoom(roomKeys: RoomKeys) {
  const room = rooms.get(roomKeys.roomKey);
  if (!room || room.sockets.size > 0) return;
  if (room.subscriber) {
    await room.subscriber.unsubscribe([roomKeys.channelKey]).catch(() => null);
  }
  rooms.delete(roomKeys.roomKey);
}

function buildAck(
  context: Pick<RoomConnectionContext, "claims">,
  ackType: "auth" | "heartbeat" | "cursor" | "typing",
): PresenceServerEvent {
  return {
    type: "ack",
    ackType,
    roomType: context.claims.roomType,
    roomId: context.claims.roomId,
    serverTime: Date.now(),
  };
}

function createInitialRateState() {
  return {
    heartbeat: { timestamps: [], lastAcceptedAt: 0 },
    cursor: { timestamps: [], lastAcceptedAt: 0 },
    typing: { timestamps: [], lastAcceptedAt: 0 },
  } satisfies RoomConnectionContext["rateState"];
}

function consumeEventRateLimit(context: RoomConnectionContext, type: "heartbeat" | "cursor" | "typing") {
  const limit = EVENT_RATE_LIMITS[type];
  const state = context.rateState[type];
  const now = Date.now();
  state.timestamps = state.timestamps.filter((timestamp) => now - timestamp < limit.windowMs);

  if (state.lastAcceptedAt > 0 && now - state.lastAcceptedAt < limit.minIntervalMs) {
    return false;
  }
  if (state.timestamps.length >= limit.maxEvents) {
    return false;
  }

  state.timestamps.push(now);
  state.lastAcceptedAt = now;
  return true;
}

function handleRateLimitedEvent(socket: WebSocket, context: RoomConnectionContext, type: "heartbeat" | "cursor" | "typing") {
  context.rateLimitViolations += 1;
  sendJson(socket, {
    type: "error",
    code: "RATE_LIMITED",
    message: `Too many ${type} events. Slow down and retry.`,
  });
  emitMetric("presence.room.rate_limited", {
    roomType: context.claims.roomType,
    roomId: context.claims.roomId,
    eventType: type,
    violations: context.rateLimitViolations,
    value: 1,
  });
  if (context.rateLimitViolations >= MAX_RATE_LIMIT_VIOLATIONS) {
    closeSocket(socket, 1013, "Presence rate limit exceeded");
  }
}

async function handlePresenceEvent(socket: WebSocket, event: PresenceClientEvent) {
  const context = socketContexts.get(socket);
  if (!context) {
    sendJson(socket, {
      type: "error",
      code: "UNAUTHORIZED",
      message: "Presence connection context is missing.",
    });
    return;
  }

  context.state.lastSeenAt = Date.now();

  switch (event.type) {
    case "heartbeat": {
      if (!consumeEventRateLimit(context, "heartbeat")) {
        handleRateLimitedEvent(socket, context, "heartbeat");
        return;
      }
      await persistMemberState(context);
      sendJson(socket, buildAck(context, "heartbeat"));
      return;
    }
    case "cursor": {
      const parsedEvent = cursorEventSchema.safeParse(event);
      if (!parsedEvent.success) {
        sendJson(socket, {
          type: "error",
          code: "BAD_PAYLOAD",
          message: "Invalid cursor event.",
        });
          return;
      }
      if (!consumeEventRateLimit(context, "cursor")) {
        handleRateLimitedEvent(socket, context, "cursor");
        return;
      }

      // Load Shattering (QoS): If room is very large, throttle cursor updates
      const room = rooms.get(context.roomKeys.roomKey);
      if (room) {
        const now = Date.now();
        // Check room size roughly every 2 seconds or if room is locally heavy
        if (now - room.lastShatterCheck > 2000) {
          const roomSize = await redis.hlen(context.roomKeys.memberHashKey);
          room.lastShatterCheck = now;
          
          if (roomSize > 100) {
             // 1M Readiness: Load-shatter if room > 100 to protect Redis Pub/Sub integrity
             emitMetric("presence.room.load_shatter", {
               roomKey: context.roomKeys.roomKey,
               size: roomSize,
               value: 1
             });
             // For now we just ack but don't publish the delta to the whole room
             // This preserves room integrity under extreme load
             sendJson(socket, buildAck(context, "cursor"));
             return;
          }
        }
      }

      if (context.claims.roomType === "workspace" && context.claims.role !== "editor") {
        sendJson(socket, {
          type: "error",
          code: "UNAUTHORIZED",
          message: "Workspace cursor updates require editor access.",
        });
        return;
      }
      context.state.cursorFrame = parsedEvent.data.frame ?? null;
      context.state.userName = parsedEvent.data.userName ?? context.state.userName;
      await persistMemberState(context);
      const delta: PresenceServerEvent = {
        type: "presence.delta",
        action: "upsert",
        roomType: context.claims.roomType,
        roomId: context.claims.roomId,
        member: context.state,
      };
      broadcastRoomLocally(context.roomKeys, delta);
      await publishPresenceEvent(context.roomKeys, delta);
      sendJson(socket, buildAck(context, "cursor"));
      emitMetric("presence.room.cursor", {
        roomType: context.claims.roomType,
        roomId: context.claims.roomId,
        value: 1,
      });
      return;
    }
    case "typing": {
      const parsedEvent = typingEventSchema.safeParse(event);
      if (!parsedEvent.success) {
        sendJson(socket, {
          type: "error",
          code: "BAD_PAYLOAD",
          message: "Invalid typing event.",
        });
        return;
      }
      if (!consumeEventRateLimit(context, "typing")) {
        handleRateLimitedEvent(socket, context, "typing");
        return;
      }
      context.state.typing = parsedEvent.data.isTyping;
      context.state.profile = parsedEvent.data.profile ?? context.state.profile;
      await persistMemberState(context);
      const delta: PresenceServerEvent = {
        type: "presence.delta",
        action: "upsert",
        roomType: context.claims.roomType,
        roomId: context.claims.roomId,
        member: context.state,
      };
      broadcastRoomLocally(context.roomKeys, delta);
      await publishPresenceEvent(context.roomKeys, delta);
      sendJson(socket, buildAck(context, "typing"));
      emitMetric("presence.room.typing", {
        roomType: context.claims.roomType,
        roomId: context.claims.roomId,
        value: 1,
      });
      return;
    }
    default: {
      sendJson(socket, {
        type: "error",
        code: "BAD_PAYLOAD",
        message: "Unsupported presence event.",
      });
    }
  }
}

async function initializePresenceConnection(websocket: WebSocket, claims: PresenceTokenClaims) {
  const roomKeys = buildRoomKeys(claims);
  const room = await ensureRoom(roomKeys);
  const connectionId = randomUUID();
  const state = toPresenceState({
    claims,
    connectionId,
  });

  const context: RoomConnectionContext = {
    connectionId,
    claims,
    roomKeys,
    state,
    rateState: createInitialRateState(),
    rateLimitViolations: 0,
  };
  socketContexts.set(websocket, context);
  room.sockets.add(websocket);

  try {
    await persistMemberState(context);
    sendJson(websocket, buildAck(context, "auth"));

    const snapshotMembers = await readRoomMembers(roomKeys);
    sendJson(websocket, {
      type: "presence.state",
      roomType: claims.roomType,
      roomId: claims.roomId,
      members: snapshotMembers,
    });

    const joinDelta: PresenceServerEvent = {
      type: "presence.delta",
      action: "upsert",
      roomType: claims.roomType,
      roomId: claims.roomId,
      member: state,
    };
    broadcastRoomLocally(roomKeys, joinDelta);
    await publishPresenceEvent(roomKeys, joinDelta);

    emitMetric("presence.room.join", {
      roomType: claims.roomType,
      roomId: claims.roomId,
      value: 1,
    });

    websocket.on("message", (message) => {
      void (async () => {
        let payload: PresenceClientEvent;
        try {
          payload = JSON.parse(message.toString()) as PresenceClientEvent;
        } catch (error) {
          sendJson(websocket, {
            type: "error",
            code: "BAD_PAYLOAD",
            message: error instanceof Error ? error.message : "Malformed presence payload.",
          });
          return;
        }

        try {
          await handlePresenceEvent(websocket, payload);
        } catch (error) {
          sendJson(websocket, {
            type: "error",
            code: "INTERNAL",
            message: "Presence event handling failed.",
          });
          emitMetric("presence.room.event_error", {
            roomType: claims.roomType,
            roomId: claims.roomId,
            value: 1,
          });
          closeSocket(websocket, 1011, "Presence event handling failed");
        }
      })();
    });

    websocket.on("close", () => {
      void (async () => {
        room.sockets.delete(websocket);
        const closedContext = socketContexts.get(websocket);
        if (!closedContext) {
          await cleanupRoom(roomKeys);
          return;
        }

        await removeMemberState(closedContext);
        const leaveDelta: PresenceServerEvent = {
          type: "presence.delta",
          action: "leave",
          roomType: closedContext.claims.roomType,
          roomId: closedContext.claims.roomId,
          member: closedContext.state,
        };
        broadcastRoomLocally(roomKeys, leaveDelta);
        await publishPresenceEvent(roomKeys, leaveDelta).catch(() => null);

        emitMetric("presence.room.leave", {
          roomType: closedContext.claims.roomType,
          roomId: closedContext.claims.roomId,
          value: 1,
        });

        await cleanupRoom(roomKeys);
      })().catch((error) => {
        console.warn("[presence] close cleanup failed", {
          roomType: claims.roomType,
          roomId: claims.roomId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    websocket.on("error", () => {
      closeSocket(websocket, 1011, "Presence connection error");
    });
  } catch (error) {
    room.sockets.delete(websocket);
    socketContexts.delete(websocket);
    await removeMemberState(context).catch(() => null);
    await cleanupRoom(roomKeys).catch(() => null);
    throw error;
  }
}

function closeSocket(socket: WebSocket, code: number, message: string) {
  try {
    socket.close(code, message);
  } catch {
    socket.terminate();
  }
}

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: false, error: "Not found" }));
});

const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on("upgrade", async (request, socket, head) => {
  try {
    const requestUrl = new URL(request.url || "/", "http://presence.local");
    if (requestUrl.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    if (requestUrl.searchParams.get("token")) {
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      const authTimeout = setTimeout(() => {
        closeSocket(websocket, 1008, "Presence authentication timed out");
      }, AUTH_TIMEOUT_MS);

      const clearAuthTimeout = () => clearTimeout(authTimeout);
      websocket.once("message", (message) => {
        void (async () => {
          try {
            const parsedMessage = authEventSchema.safeParse(JSON.parse(message.toString()));
            if (!parsedMessage.success) {
              clearAuthTimeout();
              closeSocket(websocket, 1008, "Presence authentication failed");
              return;
            }

            let claims: PresenceTokenClaims;
            try {
              claims = verifyPresenceToken(parsedMessage.data.token);
            } catch (error) {
              clearAuthTimeout();
              closeSocket(websocket, 1008, error instanceof Error ? error.message : "Presence authentication failed");
              return;
            }

            clearAuthTimeout();
            await initializePresenceConnection(websocket, claims);
          } catch (error) {
            clearAuthTimeout();
            console.error("[presence] connection initialization failed", {
              error: error instanceof Error ? error.message : String(error),
            });
            emitMetric("presence.room.join_failed", {
              value: 1,
            });
            closeSocket(websocket, 1011, "Presence connection setup failed");
          }
        })();
      });
      websocket.once("close", clearAuthTimeout);
      websocket.once("error", clearAuthTimeout);
    });
  } catch (error) {
    console.error("[presence] upgrade failed", error);
    socket.destroy();
  }
});

server.listen(PRESENCE_SERVICE_PORT, () => {
  console.info(`[presence] listening on :${PRESENCE_SERVICE_PORT} (${presenceStore.mode})`);
});
