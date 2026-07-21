import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { extensionRecoveryDrafts, extensionRecoverySessions } from "@/lib/db/schema";

export async function resolveRecoverySessionsWithoutDrafts(userId: string, sessionIds: string[]) {
  const uniqueSessionIds = Array.from(new Set(sessionIds.filter(Boolean))).slice(0, 200);
  let resolved = 0;
  for (const sessionId of uniqueSessionIds) {
    const remaining = await db.query.extensionRecoveryDrafts.findFirst({
      where: and(
        eq(extensionRecoveryDrafts.userId, userId),
        eq(extensionRecoveryDrafts.sessionId, sessionId),
        eq(extensionRecoveryDrafts.status, "finalized"),
      ),
      columns: { id: true },
    });
    if (remaining) continue;
    const updated = await db.update(extensionRecoverySessions).set({
      status: "resolved",
      resolvedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(extensionRecoverySessions.userId, userId),
      eq(extensionRecoverySessions.sessionId, sessionId),
      eq(extensionRecoverySessions.status, "interrupted"),
    )).returning({ sessionId: extensionRecoverySessions.sessionId });
    resolved += updated.length;
  }
  return resolved;
}

export async function purgeOrphanedExtensionRecoverySessions(limit = 500): Promise<number> {
  const safeLimit = Math.max(1, Math.min(2_000, Math.floor(limit)));
  const result = await db.execute<{ sessionId: string }>(sql`
    WITH candidates AS (
      SELECT sessions.session_id
      FROM extension_recovery_sessions sessions
      WHERE sessions.updated_at < NOW() - INTERVAL '90 days'
        AND NOT EXISTS (
          SELECT 1
          FROM extension_recovery_drafts drafts
          WHERE drafts.user_id = sessions.user_id
            AND drafts.session_id = sessions.session_id
        )
      ORDER BY sessions.updated_at ASC
      LIMIT ${safeLimit}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM extension_recovery_sessions sessions
    USING candidates
    WHERE sessions.session_id = candidates.session_id
    RETURNING sessions.session_id AS "sessionId"
  `);
  return Array.from(result).length;
}
