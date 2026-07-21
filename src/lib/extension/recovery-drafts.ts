import { and, asc, eq, inArray, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { extensionRecoveryDrafts, extensionRecoverySessions } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";

export const EXTENSION_RECOVERY_BUCKET = "extension-recovery-drafts";
export const MAX_RECOVERY_DRAFT_BYTES = 10 * 1024 * 1024;
export const RECOVERY_DRAFT_RETENTION_DAYS = 30;
export const RECOVERY_GENERATIONS_TO_KEEP = 3;

type DraftStorageRow = {
  id: string;
  storageKey: string;
};

async function removeStorageObjects(rows: DraftStorageRow[]) {
  if (rows.length === 0) return;
  const admin = await createAdminClient();
  for (let offset = 0; offset < rows.length; offset += 100) {
    const keys = rows.slice(offset, offset + 100).map((row) => row.storageKey);
    const { error } = await admin.storage.from(EXTENSION_RECOVERY_BUCKET).remove(keys);
    if (error) throw new Error(`Recovery draft storage cleanup failed: ${error.message}`);
  }
}

export async function deleteExtensionRecoveryDraftRows(rows: DraftStorageRow[]) {
  if (rows.length === 0) return 0;
  await removeStorageObjects(rows);
  const deleted = await db
    .delete(extensionRecoveryDrafts)
    .where(inArray(extensionRecoveryDrafts.id, rows.map((row) => row.id)))
    .returning({ id: extensionRecoveryDrafts.id });
  return deleted.length;
}

export async function deleteExtensionRecoveryDraftsForUser(userId: string) {
  const rows = await db
    .select({ id: extensionRecoveryDrafts.id, storageKey: extensionRecoveryDrafts.storageKey })
    .from(extensionRecoveryDrafts)
    .where(eq(extensionRecoveryDrafts.userId, userId));
  return deleteExtensionRecoveryDraftRows(rows);
}

export async function purgeExpiredExtensionRecoveryDrafts(limit = 500) {
  const now = new Date();
  const rows = await db
    .select({ id: extensionRecoveryDrafts.id, storageKey: extensionRecoveryDrafts.storageKey })
    .from(extensionRecoveryDrafts)
    .where(lt(extensionRecoveryDrafts.expiresAt, now))
    .orderBy(asc(extensionRecoveryDrafts.expiresAt))
    .limit(Math.max(1, Math.min(2_000, limit)));
  return deleteExtensionRecoveryDraftRows(rows);
}

export async function purgeCleanSessionRecoveryDrafts(limit = 500) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: extensionRecoveryDrafts.id, storageKey: extensionRecoveryDrafts.storageKey })
    .from(extensionRecoveryDrafts)
    .innerJoin(
      extensionRecoverySessions,
      and(
        eq(extensionRecoverySessions.userId, extensionRecoveryDrafts.userId),
        eq(extensionRecoverySessions.sessionId, extensionRecoveryDrafts.sessionId),
      ),
    )
    .where(and(
      eq(extensionRecoverySessions.status, "clean"),
      lt(extensionRecoverySessions.updatedAt, cutoff),
    ))
    .orderBy(asc(extensionRecoverySessions.updatedAt))
    .limit(Math.max(1, Math.min(2_000, limit)));
  return deleteExtensionRecoveryDraftRows(rows);
}

export async function pruneExtensionRecoveryGenerations(input: {
  userId: string;
  deviceId: string;
  projectId: string;
  filePath: string;
}) {
  const rows = await db.query.extensionRecoveryDrafts.findMany({
    where: and(
      eq(extensionRecoveryDrafts.userId, input.userId),
      eq(extensionRecoveryDrafts.deviceId, input.deviceId),
      eq(extensionRecoveryDrafts.projectId, input.projectId),
      eq(extensionRecoveryDrafts.filePath, input.filePath),
      eq(extensionRecoveryDrafts.status, "finalized"),
    ),
    columns: { id: true, storageKey: true },
    orderBy: (draft, { desc }) => [desc(draft.capturedAt), desc(draft.createdAt)],
  });
  return deleteExtensionRecoveryDraftRows(rows.slice(RECOVERY_GENERATIONS_TO_KEEP));
}
