import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getRequestId, getRequestIp } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { conversationParticipants, projectMembers } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { resolvePresenceWebSocketUrl } from "@/lib/realtime/presence-config";
import { createPresenceTokenClaims, signPresenceToken } from "@/lib/realtime/presence-token";
import type { PresenceRoomRole, PresenceRoomType } from "@/lib/realtime/presence-types";
import { consumeRateLimitPolicy } from "@/lib/security/rate-limit";
import { getViewerAuthContext } from "@/lib/server/viewer-context";

const requestSchema = z.object({
  roomType: z.enum(["conversation", "workspace"]),
  roomId: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_:-]+$/, 'Invalid room ID format'),
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

    const role: PresenceRoomRole =
      parsed.data.role === "viewer"
        ? "viewer"
        : roomAccess.role === "editor" || roomAccess.role === "viewer"
          ? roomAccess.role
          : "viewer";
    const claims = createPresenceTokenClaims({
      userId: auth.userId,
      sessionId: auth.snapshot?.sessionId ?? null,
      roomType: parsed.data.roomType,
      roomId: parsed.data.roomId,
      role,
    });
    const token = signPresenceToken(claims);
    const wsUrl = resolvePresenceWsUrl();
    if (!wsUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: "Presence service is not configured for this environment.",
        },
        { status: 503 },
      );
    }

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
    logger.error("presence.token.issue.failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to issue presence room token",
      },
      { status: 500 },
    );
  }
}
