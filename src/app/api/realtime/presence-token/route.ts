import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { getRequestId, getRequestIp } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { conversationParticipants, projectMembers, projects, tasks } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { resolvePresenceWebSocketUrl } from "@/lib/realtime/presence-config";
import {
  createPresenceTokenClaims,
  MISSING_PRESENCE_SECRET_ERROR_CODE,
  MissingPresenceSecretError,
  signPresenceToken,
} from "@/lib/realtime/presence-token";
import type { PresenceRoomRole, PresenceRoomType } from "@/lib/realtime/presence-types";
import { consumeRateLimitPolicy } from "@/lib/security/rate-limit";
import { getViewerAuthContext } from "@/lib/server/viewer-context";

const requestSchema = z.object({
  roomType: z.enum(["conversation", "workspace", "user", "task"]),
  roomId: z.string().uuid("Invalid room ID format"),
  role: z.enum(["viewer", "editor"]).optional(),
});

function resolvePresenceWsUrl() {
  return resolvePresenceWebSocketUrl();
}

async function assertPresenceRoomAccess(input: {
  roomType: PresenceRoomType;
  roomId: string;
  userId: string;
}) {
  if (input.roomType === "conversation") {
    const [membership] = await db
      .select({ id: conversationParticipants.id })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, input.roomId),
          eq(conversationParticipants.userId, input.userId),
        ),
      )
      .limit(1);

    return membership
      ? {
          allowed: true as const,
          role: "viewer" as PresenceRoomRole,
        }
      : {
          allowed: false as const,
          role: null,
        };
  }

  // Wave 2 — Presence & online dot: per-user presence rooms.
  //   roomType: "user", roomId: <target userId>
  //   - Self-publish: if viewer is the owner of the room (userId === roomId),
  //     they may claim editor role so their `presence.delta` upsert is what
  //     broadcasts "I'm online" to peers observing this room.
  //   - Peer observe: any user that shares at least one conversation with the
  //     room owner may join as viewer — they see presence.state snapshots and
  //     presence.delta upsert/leave events, which drive the online dot in the
  //     conversation list / header. This mirrors the privacy boundary we
  //     already enforce for DMs (you can only see presence for people you can
  //     already exchange messages with).
  if (input.roomType === "user") {
    if (input.roomId === input.userId) {
      return {
        allowed: true as const,
        role: "editor" as PresenceRoomRole,
      };
    }

    const viewerParticipation = alias(conversationParticipants, "viewer_cp");
    const ownerParticipation = alias(conversationParticipants, "owner_cp");

    const [sharedConversation] = await db
      .select({ conversationId: viewerParticipation.conversationId })
      .from(viewerParticipation)
      .innerJoin(
        ownerParticipation,
        eq(viewerParticipation.conversationId, ownerParticipation.conversationId),
      )
      .where(
        and(
          eq(viewerParticipation.userId, input.userId),
          eq(ownerParticipation.userId, input.roomId),
        ),
      )
      .limit(1);

    return sharedConversation
      ? {
          allowed: true as const,
          role: "viewer" as PresenceRoomRole,
        }
      : {
          allowed: false as const,
          role: null,
        };
  }

  if (input.roomType === "task") {
    const [taskRoom] = await db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
      })
      .from(tasks)
      .where(eq(tasks.id, input.roomId))
      .limit(1);

    if (!taskRoom) {
      return {
        allowed: false as const,
        role: null,
      };
    }

    const [projectOwner] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, taskRoom.projectId))
      .limit(1);

    if (projectOwner?.ownerId === input.userId) {
      return {
        allowed: true as const,
        role: "viewer" as PresenceRoomRole,
      };
    }

    const [membership] = await db
      .select({
        role: projectMembers.role,
      })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, taskRoom.projectId),
          eq(projectMembers.userId, input.userId),
        ),
      )
      .limit(1);

    return membership
      ? {
          allowed: true as const,
          role: "viewer" as PresenceRoomRole,
        }
      : {
          allowed: false as const,
          role: null,
        };
  }

  const [membership] = await db
    .select({
      id: projectMembers.projectId,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, input.roomId),
        eq(projectMembers.userId, input.userId),
      ),
    )
    .limit(1);

  if (!membership) {
    return {
      allowed: false as const,
      role: null,
    };
  }

  return {
    allowed: true as const,
    role: membership.role === "viewer" ? "viewer" : "editor",
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);

  try {
    const auth = await getViewerAuthContext();
    if (!auth.userId || !auth.user) {
      return NextResponse.json(
        {
          ok: false,
          error: "Not authenticated",
        },
        { status: 401 },
      );
    }

    if (!auth.emailVerified) {
      return NextResponse.json(
        {
          ok: false,
          error: "Email verification is required before joining realtime rooms.",
        },
        { status: 403 },
      );
    }

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid presence room request",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const rateLimit = await consumeRateLimitPolicy({
      scope: "presence-token",
      burst: 30,
      refillRate: 0.5,
      keyParts: [auth.userId, parsed.data.roomType, parsed.data.roomId, getRequestIp(request)],
      failMode: "fail_closed",
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "Presence token rate limit exceeded",
        },
        { status: 429 },
      );
    }

    const roomAccess = await assertPresenceRoomAccess({
      roomType: parsed.data.roomType,
      roomId: parsed.data.roomId,
      userId: auth.userId,
    });
    if (!roomAccess.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "You do not have access to this realtime room.",
        },
        { status: 403 },
      );
    }

    const wsUrl = resolvePresenceWsUrl();
    const role: PresenceRoomRole =
      parsed.data.role === "viewer"
        ? "viewer"
        : roomAccess.role === "editor" || roomAccess.role === "viewer"
          ? roomAccess.role
          : "viewer";
    if (!wsUrl) {
      logger.metric("presence.token.disabled", {
        requestId,
        userId: auth.userId,
        roomType: parsed.data.roomType,
        role,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({
        ok: true,
        data: {
          token: null,
          expiresAt: null,
          roomType: parsed.data.roomType,
          roomId: parsed.data.roomId,
          role,
          wsUrl: null,
          disabled: true,
        },
      });
    }

    const claims = createPresenceTokenClaims({
      userId: auth.userId,
      sessionId: auth.snapshot?.sessionId ?? null,
      roomType: parsed.data.roomType,
      roomId: parsed.data.roomId,
      role,
    });
    const token = signPresenceToken(claims);

    logger.metric("presence.token.issued", {
      requestId,
      userId: auth.userId,
      roomType: parsed.data.roomType,
      role,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      data: {
        token,
        expiresAt: claims.exp,
        roomType: claims.roomType,
        roomId: claims.roomId,
        role,
        wsUrl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("presence.token.issue.failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      error: message,
    });
    if (
      error instanceof MissingPresenceSecretError
      || (typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === MISSING_PRESENCE_SECRET_ERROR_CODE)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Presence service is not configured for this environment.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to issue presence room token",
      },
      { status: 500 },
    );
  }
}
