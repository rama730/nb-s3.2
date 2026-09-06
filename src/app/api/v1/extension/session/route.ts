import crypto from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { enforceRouteLimit, jsonError, jsonSuccess, getRequestIp } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { extensionDeviceSessionEvents, extensionDeviceSessions } from "@/lib/db/schema";
import { EXTENSION_DEVICE_SESSION_EVENTS } from "@/lib/extension/session-events";
import { logger } from "@/lib/logger";
import { validateCsrf } from "@/lib/security/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("authorization")?.trim();
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  return token.startsWith("nb_dev_") ? token : null;
}

// ponytail: in-memory short TTL cache to avoid hammering DB with 1M heartbeats
const SESSION_CACHE_TTL_MS = 30_000;
type CachedSession = { sessionId: string; active: boolean; cachedAt: number };
const sessionStatusCache = new Map<string, CachedSession>();
const MAX_SESSION_CACHE_SIZE = 10_000;

export function invalidateExtensionSessionCache(tokenHash?: string) {
  if (tokenHash) {
    sessionStatusCache.delete(tokenHash);
  } else {
    sessionStatusCache.clear();
  }
}

export async function GET(request: Request) {
  const limitResponse = await enforceRouteLimit(request, "api:v1:extension:session:status", 60, 60);
  if (limitResponse) return limitResponse;

  const token = getBearerToken(request);
  if (!token) {
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  const cached = sessionStatusCache.get(tokenHash);
  if (cached && now - cached.cachedAt < SESSION_CACHE_TTL_MS) {
    // ponytail: revoked tokens may read only their own liveness so the IDE can erase them after web-side disconnect.
    return jsonSuccess(
      {
        sessionId: cached.sessionId,
        active: cached.active,
      },
      undefined,
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const session = await db.query.extensionDeviceSessions.findFirst({
    where: eq(extensionDeviceSessions.tokenHash, tokenHash),
    columns: {
      id: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (!session) {
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  const active = !session.revokedAt && session.expiresAt.getTime() > now;
  if (sessionStatusCache.size >= MAX_SESSION_CACHE_SIZE) {
    const oldestKey = sessionStatusCache.keys().next().value;
    if (oldestKey) sessionStatusCache.delete(oldestKey);
  }
  sessionStatusCache.set(tokenHash, { sessionId: session.id, active, cachedAt: now });

  // ponytail: revoked tokens may read only their own liveness so the IDE can erase them after web-side disconnect.
  return jsonSuccess(
    {
      sessionId: session.id,
      active,
    },
    undefined,
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  try {
    const limitResponse = await enforceRouteLimit(request, "api:v1:extension:session:revoke", 30, 60);
    if (limitResponse) return limitResponse;

    const token = getBearerToken(request);
    if (!token) {
      return jsonError("Not authenticated", 401, "UNAUTHORIZED");
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = await db.query.extensionDeviceSessions.findFirst({
      where: eq(extensionDeviceSessions.tokenHash, tokenHash),
    });

    if (!session) {
      return jsonError("Not authenticated", 401, "UNAUTHORIZED");
    }

    if (session.revokedAt) {
      return jsonSuccess({ revoked: true });
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(extensionDeviceSessions)
        .set({
          revokedAt: now,
          revocationReason: "extension_disconnect",
        })
        .where(
          and(
            eq(extensionDeviceSessions.id, session.id),
            isNull(extensionDeviceSessions.revokedAt),
          ),
        )
        .returning({ id: extensionDeviceSessions.id });

      if (!revoked) return;

      await tx.insert(extensionDeviceSessionEvents).values({
        sessionId: session.id,
        eventType: EXTENSION_DEVICE_SESSION_EVENTS.revocation,
        ipAddress: getRequestIp(request),
        userAgent: request.headers.get("user-agent")?.trim() || null,
        metadata: { reason: "extension_disconnect" },
        createdAt: now,
      });
    });

    sessionStatusCache.delete(tokenHash);

    return jsonSuccess({ revoked: true });
  } catch (error) {
    logger.error("[api/v1/extension/session] Failed to revoke extension session", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError("Failed to revoke extension session", 500, "INTERNAL_ERROR");
  }
}
