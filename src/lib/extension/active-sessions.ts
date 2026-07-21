import "server-only";

import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  extensionDeviceSessionEvents,
  extensionDeviceSessions,
} from "@/lib/db/schema";
import { EXTENSION_DEVICE_SESSION_EVENTS } from "@/lib/extension/session-events";
import type { ExtensionSessionAuthMethod } from "@/lib/types/settingsTypes";

const sessionCursorSchema = z.object({
  lastSeenAt: z.string().datetime(),
  id: z.string().uuid(),
});

export type ActiveExtensionSession = typeof extensionDeviceSessions.$inferSelect & {
  authMethod: ExtensionSessionAuthMethod;
};

export function normalizeExtensionAuthMethod(
  value: unknown,
  deviceName: string,
): ExtensionSessionAuthMethod {
  if (value === "web_login" || value === "browser_flow") return "web_login";
  if (value === "manual_token") return "manual_token";
  return /\bbrowser flow\b/i.test(deviceName) ? "web_login" : "manual_token";
}

function decodeSessionCursor(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = sessionCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return { lastSeenAt: new Date(parsed.lastSeenAt), id: parsed.id };
  } catch {
    throw new Error("Invalid extension session cursor.");
  }
}

function encodeSessionCursor(value: { lastSeenAt: Date; id: string }) {
  return Buffer.from(JSON.stringify({
    lastSeenAt: value.lastSeenAt.toISOString(),
    id: value.id,
  })).toString("base64url");
}

export async function listActiveExtensionSessionsForUser(
  userId: string,
  options: { limit?: number; cursor?: string | null } = {},
) {
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 50)));
  const cursor = decodeSessionCursor(options.cursor);
  const now = new Date();
  const rows = await db.query.extensionDeviceSessions.findMany({
    where: and(
      eq(extensionDeviceSessions.userId, userId),
      isNull(extensionDeviceSessions.revokedAt),
      gt(extensionDeviceSessions.expiresAt, now),
      cursor
        ? or(
            lt(extensionDeviceSessions.lastSeenAt, cursor.lastSeenAt),
            and(
              eq(extensionDeviceSessions.lastSeenAt, cursor.lastSeenAt),
              lt(extensionDeviceSessions.id, cursor.id),
            ),
          )
        : undefined,
    ),
    orderBy: [
      desc(extensionDeviceSessions.lastSeenAt),
      desc(extensionDeviceSessions.id),
    ],
    limit: limit + 1,
  });

  const hasMore = rows.length > limit;
  const sessions = hasMore ? rows.slice(0, limit) : rows;
  const loginEventBySessionId = new Map<string, { authMethod: ExtensionSessionAuthMethod }>();

  if (sessions.length > 0) {
    const sessionIds = sessions.map((session) => session.id);
    const loginEvents = await db.execute<{
      session_id: string;
      metadata: unknown;
    }>(sql`
      SELECT DISTINCT ON (${extensionDeviceSessionEvents.sessionId})
        ${extensionDeviceSessionEvents.sessionId} AS session_id,
        ${extensionDeviceSessionEvents.metadata} AS metadata
      FROM ${extensionDeviceSessionEvents}
      WHERE ${extensionDeviceSessionEvents.eventType} = ${EXTENSION_DEVICE_SESSION_EVENTS.login}
        AND ${extensionDeviceSessionEvents.sessionId} IN (
          ${sql.join(sessionIds.map((id) => sql`${id}`), sql`, `)}
        )
      ORDER BY
        ${extensionDeviceSessionEvents.sessionId},
        ${extensionDeviceSessionEvents.createdAt} DESC
    `);

    for (const event of Array.from(loginEvents)) {
      const metadata = event.metadata as { method?: unknown } | null;
      const session = sessions.find((candidate) => candidate.id === event.session_id);
      loginEventBySessionId.set(event.session_id, {
        authMethod: normalizeExtensionAuthMethod(
          metadata?.method,
          session?.deviceName ?? "",
        ),
      });
    }
  }

  const enriched: ActiveExtensionSession[] = sessions.map((session) => ({
    ...session,
    authMethod:
      loginEventBySessionId.get(session.id)?.authMethod
      ?? normalizeExtensionAuthMethod(null, session.deviceName),
  }));
  const lastSession = enriched.at(-1);

  return {
    sessions: enriched,
    hasMore,
    nextCursor: hasMore && lastSession
      ? encodeSessionCursor({ lastSeenAt: lastSession.lastSeenAt, id: lastSession.id })
      : null,
  };
}
