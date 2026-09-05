import crypto from "crypto";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { enforceRouteLimit, getRequestIp, jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { extensionDeviceSessionEvents, extensionDeviceSessions } from "@/lib/db/schema";
import { verifyExtensionAuthCode } from "@/lib/extension/auth-code";
import { recordExtensionMetric } from "@/lib/extension/observability";
import { EXTENSION_DEVICE_SESSION_EVENTS } from "@/lib/extension/session-events";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CSRF exemption: this editor-to-browser exchange has no ambient cookie
// authority. It is protected by a short-lived, single-use authorization code
// plus a timing-safe state nonce bound to the requesting editor session.
const csrfProtection = "one-time-code-and-state" as const;
void csrfProtection;

const exchangeSchema = z.object({
  code: z.string().min(16),
  state: z.string().max(256).optional().nullable(),
});

function readMetadata(event: typeof extensionDeviceSessionEvents.$inferSelect) {
  return event.metadata && typeof event.metadata === "object"
    ? event.metadata as Record<string, unknown>
    : {};
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const limitResponse = await enforceRouteLimit(request, "api:v1:extension:auth-code", 30, 60);
  if (limitResponse) return limitResponse;

  try {
    const body = await request.json().catch(() => null);
    const parsed = exchangeSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid authorization code request", 400, "BAD_REQUEST");
    }

    const verified = verifyExtensionAuthCode(parsed.data.code);
    const tokenHash = crypto.createHash("sha256").update(verified.rawToken).digest("hex");
    const now = new Date();
    const userAgent = request.headers.get("user-agent")?.trim() || null;
    const ipAddress = getRequestIp(request);

    const session = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${verified.codeHash}))`);

      const [activeSession] = await tx
        .select()
        .from(extensionDeviceSessions)
        .where(
          and(
            eq(extensionDeviceSessions.id, verified.sessionId),
            eq(extensionDeviceSessions.userId, verified.userId),
            eq(extensionDeviceSessions.tokenHash, tokenHash),
            isNull(extensionDeviceSessions.revokedAt),
            gt(extensionDeviceSessions.expiresAt, now),
          ),
        )
        .limit(1);

      if (!activeSession) {
        throw new Error("Extension session is no longer active.");
      }

      const events = await tx
        .select()
        .from(extensionDeviceSessionEvents)
        .where(
            and(
              eq(extensionDeviceSessionEvents.sessionId, verified.sessionId),
              inArray(extensionDeviceSessionEvents.eventType, [
                EXTENSION_DEVICE_SESSION_EVENTS.authCodeIssued,
                EXTENSION_DEVICE_SESSION_EVENTS.authCodeConsumed,
              ]),
            ),
        )
        .orderBy(desc(extensionDeviceSessionEvents.createdAt))
        .limit(50);

      const issuedEvent = events.find((event) => {
        const metadata = readMetadata(event);
        return event.eventType === EXTENSION_DEVICE_SESSION_EVENTS.authCodeIssued
          && metadata.codeHash === verified.codeHash;
      });
      if (!issuedEvent) {
        throw new Error("Authorization code was not issued by this session.");
      }

      const issuedMetadata = readMetadata(issuedEvent);
      const issuedExpiresAt = typeof issuedMetadata.expiresAt === "string"
        ? new Date(issuedMetadata.expiresAt)
        : verified.expiresAt;
      if (issuedExpiresAt.getTime() <= now.getTime()) {
        throw new Error("Authorization code expired. Start the connection again.");
      }

      const requestStateHash = typeof issuedMetadata.requestStateHash === "string"
        ? issuedMetadata.requestStateHash
        : "";
      const receivedStateHash = parsed.data.state
        ? crypto.createHash("sha256").update(parsed.data.state).digest("hex")
        : "";
      if (
        requestStateHash.length !== receivedStateHash.length
        || !requestStateHash
        || !crypto.timingSafeEqual(Buffer.from(requestStateHash), Buffer.from(receivedStateHash))
      ) {
        throw new Error("Authorization state did not match this editor request.");
      }

      const alreadyConsumed = events.some((event) => {
        const metadata = readMetadata(event);
        return event.eventType === EXTENSION_DEVICE_SESSION_EVENTS.authCodeConsumed
          && metadata.codeHash === verified.codeHash;
      });
      if (alreadyConsumed) {
        throw new Error("Authorization code already used. Start the connection again.");
      }

      await tx.insert(extensionDeviceSessionEvents).values({
        sessionId: verified.sessionId,
        eventType: EXTENSION_DEVICE_SESSION_EVENTS.authCodeConsumed,
        ipAddress,
        userAgent,
        metadata: {
          codeHash: verified.codeHash,
          codeId: verified.codeId,
          requestStateHash,
        },
        createdAt: now,
      });

      await tx
        .update(extensionDeviceSessions)
        .set({ lastSeenAt: now, userAgent })
        .where(eq(extensionDeviceSessions.id, activeSession.id));

      return activeSession;
    });

    recordExtensionMetric("extension.auth_code.exchange", {
      action: "exchange",
      success: true,
      userId: verified.userId,
      sessionId: verified.sessionId,
      durationMs: Date.now() - startedAt,
    });

    return jsonSuccess({
      token: verified.rawToken,
      tokenPrefix: session.tokenPrefix,
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authorization code exchange failed";
    logger.warn("[api/v1/extension/auth-code] exchange failed", {
      action: "exchange",
      success: false,
      error: message,
      durationMs: Date.now() - startedAt,
    });
    recordExtensionMetric("extension.auth_code.exchange", {
      action: "exchange",
      success: false,
      errorCode: "UNAUTHORIZED",
      durationMs: Date.now() - startedAt,
    });
    return jsonError(message, 401, "UNAUTHORIZED");
  }
}
