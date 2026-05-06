"use server";

import { db } from "@/lib/db";
import { fileVersions, projectNodes, type FileVersion } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";
import {
  buildProjectFileKey,
  isCanonicalProjectFileKey,
  parseProjectFileKey,
} from "@/lib/storage/project-file-key";
import {
  normalizeAndValidateFileSize,
  normalizeAndValidateMimeType,
  normalizeAndValidateUploadRelativePath,
  PROJECT_UPLOAD_MAX_FILE_BYTES,
} from "@/lib/upload/security";
import { finalizeUploadIntent } from "@/lib/upload/upload-intents";
import { notifyTaskParticipantsForFileEvent } from "@/lib/notifications/task-file";
import {
  assertProjectReadAccess,
  assertProjectWriteAccess,
  assertProjectWriteAccessTx,
  assertNodeNotLockedByAnotherUser,
  recordNodeEvent,
} from "./_shared";

/**
 * Server actions for the task-file version history.
 *
 * The lifecycle mirrors `createFileNode` in `mutations.ts` but appends to the
 * existing node instead of creating a sibling. Each call bumps
 * `project_nodes.current_version` in the same transaction as the insert into
 * `file_versions`, so the two stay consistent.
 *
 * Every action re-verifies write access against the project *inside* the
 * transaction via `assertProjectWriteAccessTx` (row-locks the project and
 * the caller's membership row) to close the TOCTOU window between check
 * and mutation — same pattern used everywhere else in files/mutations.ts.
 */

const LIST_VERSIONS_MAX = 200;

export async function listFileVersions(
  projectId: string,
  nodeId: string,
): Promise<FileVersion[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const actorId = user?.id ?? null;
  await assertProjectReadAccess(projectId, actorId);

  // Confirm the node belongs to the project (defense-in-depth on top of RLS).
  const node = await db.query.projectNodes.findFirst({
    where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
    columns: { id: true, type: true },
  });
  if (!node) throw new Error("File not found");
  if (node.type !== "file") throw new Error("Versions are tracked only on files");

  const rows = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.nodeId, nodeId))
    .orderBy(desc(fileVersions.version))
    .limit(LIST_VERSIONS_MAX);
  return rows;
}

/**
 * Mint a short-lived signed URL pointing at a specific historical version of
 * a file. Used by the version-history drawer's "Download" button.
 */
export async function getVersionSignedUrl(
  projectId: string,
  nodeId: string,
  version: number,
  ttlSeconds: number = 300,
): Promise<{ url: string; expiresAt: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const actorId = user?.id ?? null;
  await assertProjectReadAccess(projectId, actorId);
  const clampedTtl = Math.max(30, Math.min(3600, ttlSeconds));

  const version_row = await db.query.fileVersions.findFirst({
    where: and(eq(fileVersions.nodeId, nodeId), eq(fileVersions.version, version)),
    columns: { s3Key: true },
  });
  if (!version_row?.s3Key) throw new Error("Version not found");

  // Sanity: the key must belong to this project.
  const parsed = parseProjectFileKey(version_row.s3Key);
  if (!parsed || parsed.projectId !== projectId) {
    throw new Error("Version key does not belong to this project");
  }

  const admin = await createAdminClient();
  const { data, error } = await admin.storage
    .from("project-files")
    .createSignedUrl(version_row.s3Key, clampedTtl);
  if (error || !data?.signedUrl) throw new Error("Failed to create signed URL");

  return { url: data.signedUrl, expiresAt: Date.now() + clampedTtl * 1000 };
}

/**
 * Append a new version to an existing file node.
 *
 * Flow
 *   1. Finalize the upload intent (same guard as createFileNode).
 *   2. Inside a tx, lock the project row, assert write access, verify no one
 *      else holds a collaborator lock on the node, read the current
 *      projectNodes row, compute the next version number.
 *   3. Insert `file_versions` row with (version, s3_key, size, mime, hash).
 *   4. Update `project_nodes.{s3Key,size,mimeType,current_version,updatedAt}`
 *      so readers that don't know about `file_versions` still see the latest
 *      blob.
 *
 * Note on content_hash: the client sends it (computed via
 * `@/lib/files/content-hash`). We accept it as-is; hash correctness isn't
 * security-sensitive (it's only used for dedup), and the server recomputes
 * if/when this file is picked up by the lazy backfill job.
 */
export async function replaceNodeWithNewVersion(input: {
  projectId: string;
  nodeId: string;
  s3Key: string;
  size: number;
  mimeType: string;
  contentHash: string | null;
  uploadIntentId?: string;
  comment?: string | null;
}): Promise<{ node: typeof projectNodes.$inferSelect; version: FileVersion }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { allowed } = await consumeRateLimit(`files-versions:${user.id}`, 30, 60);
  if (!allowed) throw new Error("Rate limit exceeded");
  await assertProjectWriteAccess(input.projectId, user.id);

  const finalizedIntent = await finalizeUploadIntent({
    intentId: input.uploadIntentId,
    storageKey: input.s3Key,
    bucket: "project-files",
    userId: user.id,
    projectId: input.projectId,
    expectedScope: "project_file",
    expectedKind: "file",
  });

  const parsedKey = parseProjectFileKey(finalizedIntent.storageKey);
  if (
    !parsedKey ||
    !isCanonicalProjectFileKey(finalizedIntent.storageKey) ||
    parsedKey.projectId !== input.projectId
  ) {
    throw new Error("Invalid file storage key");
  }
  const normalizedRelativePath = normalizeAndValidateUploadRelativePath(parsedKey.relativePath);
  const canonicalS3Key = buildProjectFileKey(input.projectId, normalizedRelativePath);
  const normalizedSize = normalizeAndValidateFileSize(
    finalizedIntent.finalizedSize ?? input.size,
    PROJECT_UPLOAD_MAX_FILE_BYTES,
  );
  const normalizedMimeType = normalizeAndValidateMimeType(
    finalizedIntent.finalizedMimeType ?? input.mimeType,
  );

  const normalizedHash = sanitizeHash(input.contentHash);
  const normalizedComment = input.comment?.trim() ? input.comment.trim().slice(0, 500) : null;

  const result = await db.transaction(async (tx) => {
    await assertProjectWriteAccessTx(tx, input.projectId, user.id);
    await assertNodeNotLockedByAnotherUser(input.projectId, input.nodeId, user.id, tx);

    const current = await tx.query.projectNodes.findFirst({
      where: and(
        eq(projectNodes.id, input.nodeId),
        eq(projectNodes.projectId, input.projectId),
      ),
      columns: {
        id: true,
        type: true,
        currentVersion: true,
        deletedAt: true,
      },
    });
    if (!current || current.deletedAt) throw new Error("File not found");
    if (current.type !== "file") throw new Error("Only file nodes support versions");

    const nextVersion = (current.currentVersion ?? 1) + 1;

    const [versionRow] = await tx
      .insert(fileVersions)
      .values({
        nodeId: input.nodeId,
        version: nextVersion,
        s3Key: canonicalS3Key,
        size: normalizedSize,
        mimeType: normalizedMimeType,
        contentHash: normalizedHash,
        uploadedBy: user.id,
        comment: normalizedComment,
      })
      .returning();

    const [updatedNode] = await tx
      .update(projectNodes)
      .set({
        s3Key: canonicalS3Key,
        size: normalizedSize,
        mimeType: normalizedMimeType,
        currentVersion: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(projectNodes.id, input.nodeId))
      .returning();

    return { node: updatedNode, version: versionRow };
  });

  await recordNodeEvent(input.projectId, user.id, input.nodeId, "replace_file_version", {
    version: result.version.version,
    size: normalizedSize,
    mimeType: normalizedMimeType,
    hash: normalizedHash,
  });
  try {
    await notifyTaskParticipantsForFileEvent({
      actorUserId: user.id,
      projectId: input.projectId,
      nodeId: input.nodeId,
      kind: "task_file_version",
      version: result.version.version,
    });
  } catch (error) {
    logger.warn("files.version.notification_failed", {
      module: "files",
      projectId: input.projectId,
      nodeId: input.nodeId,
      version: result.version.version,
      actorUserId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  revalidatePath(`/projects/${input.projectId}`);
  return result;
}

/**
 * Restore an earlier version by copying its metadata forward as a new
 * current version (never rewrites history). We intentionally re-use the
 * old `s3Key` — blobs are write-once, so pointing the latest row back at
 * the old key is safe and cheap.
 */
export async function restoreFileVersion(
  projectId: string,
  nodeId: string,
  targetVersion: number,
): Promise<{ node: typeof projectNodes.$inferSelect; version: FileVersion }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { allowed } = await consumeRateLimit(`files-versions:${user.id}`, 30, 60);
  if (!allowed) throw new Error("Rate limit exceeded");
  await assertProjectWriteAccess(projectId, user.id);

  const result = await db.transaction(async (tx) => {
    await assertProjectWriteAccessTx(tx, projectId, user.id);
    await assertNodeNotLockedByAnotherUser(projectId, nodeId, user.id, tx);

    const current = await tx.query.projectNodes.findFirst({
      where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
      columns: { id: true, type: true, currentVersion: true, deletedAt: true },
    });
    if (!current || current.deletedAt) throw new Error("File not found");
    if (current.type !== "file") throw new Error("Only file nodes support versions");

    const source = await tx.query.fileVersions.findFirst({
      where: and(eq(fileVersions.nodeId, nodeId), eq(fileVersions.version, targetVersion)),
    });
    if (!source) throw new Error("Version not found");

    const nextVersion = (current.currentVersion ?? 1) + 1;

    const [versionRow] = await tx
      .insert(fileVersions)
      .values({
        nodeId,
        version: nextVersion,
        s3Key: source.s3Key,
        size: source.size,
        mimeType: source.mimeType,
        contentHash: source.contentHash,
        uploadedBy: user.id,
        comment: `Restored from v${source.version}`,
      })
      .returning();

    const [updatedNode] = await tx
      .update(projectNodes)
      .set({
        s3Key: source.s3Key,
        size: source.size,
        mimeType: source.mimeType,
        currentVersion: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(projectNodes.id, nodeId))
      .returning();

    return { node: updatedNode, version: versionRow };
  });

  await recordNodeEvent(projectId, user.id, nodeId, "restore_file_version", {
    restoredFrom: targetVersion,
    newVersion: result.version.version,
  });
  revalidatePath(`/projects/${projectId}`);
  return result;
}

function sanitizeHash(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  // SHA-256 is 64 lowercase hex chars.
  if (!/^[0-9a-f]{64}$/.test(trimmed)) return null;
  return trimmed;
}
