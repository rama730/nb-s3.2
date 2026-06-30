"use server";

import { db } from "@/lib/db";
import { fileVersions, profiles, projectNodeLocks, projectNodes, type FileVersion } from "@/lib/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";
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
import { notifyForFileVersionCreated } from "@/lib/notifications/task-file";
import { enqueueProjectNotificationEvent } from "@/lib/notifications/project-events";
import {
  assertProjectFileReadAccess,
  assertProjectUploadAccess,
  assertProjectUploadAccessTx,
  assertProjectWriteAccess,
  assertProjectWriteAccessTx,
  assertNodeNotLockedByAnotherUser,
  recordNodeEvent,
} from "@/lib/files/internal-helpers";

/**
 * Server actions for the task-file version history.
 *
 * The lifecycle mirrors `createFileNode` in `mutations.ts` but appends to the
 * existing node instead of creating a sibling. Each call bumps
 * `project_nodes.current_version` in the same transaction as the insert into
 * `file_versions`, so the two stay consistent.
 *
 * Upload-like actions re-verify upload access inside the transaction
 * (`assertProjectUploadAccessTx`) so per-member file-intake toggles cannot be
 * bypassed between signed upload creation and version replacement.
 */

const LIST_VERSIONS_MAX = 200;

function actorNotificationSnapshot(user: { user_metadata?: Record<string, unknown> | null }) {
  return {
    actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
    actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };
}

async function enqueueProjectFileVersionNotification(input: Parameters<typeof enqueueProjectNotificationEvent>[0]) {
  try {
    await enqueueProjectNotificationEvent(input);
  } catch (error) {
    logger.warn("files.project_policy_notification_failed", {
      module: "files",
      projectId: input.projectId,
      eventKey: input.eventKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function listFileVersions(
  projectId: string,
  nodeId: string,
): Promise<(FileVersion & { uploadedByName?: string | null; uploadedByUsername?: string | null })[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const actorId = user?.id ?? null;
  await assertProjectFileReadAccess(projectId, actorId);

  // Confirm the node belongs to the project (defense-in-depth on top of RLS).
  const node = await db.query.projectNodes.findFirst({
    where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
    columns: { id: true, type: true },
  });
  if (!node) throw new Error("File not found");
  if (node.type !== "file") throw new Error("Versions are tracked only on files");

  const rows = await db
    .select({
      id: fileVersions.id,
      nodeId: fileVersions.nodeId,
      version: fileVersions.version,
      s3Key: fileVersions.s3Key,
      size: fileVersions.size,
      mimeType: fileVersions.mimeType,
      contentHash: fileVersions.contentHash,
      uploadedBy: fileVersions.uploadedBy,
      uploadedAt: fileVersions.uploadedAt,
      comment: fileVersions.comment,
      uploadedByName: profiles.fullName,
      uploadedByUsername: profiles.username,
    })
    .from(fileVersions)
    .leftJoin(profiles, eq(fileVersions.uploadedBy, profiles.id))
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
  download: boolean = false,
): Promise<{ url: string; expiresAt: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const actorId = user?.id ?? null;
  await assertProjectFileReadAccess(projectId, actorId);
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
    .createSignedUrl(version_row.s3Key, clampedTtl, { download });
  if (error || !data?.signedUrl) throw new Error("Failed to create signed URL");

  return { url: data.signedUrl, expiresAt: Date.now() + clampedTtl * 1000 };
}

/**
 * Structured error returned when a lock conflict prevents a version write.
 */
export interface LockConflictError {
  error: "lock_conflict";
  lockedBy: { userId: string; displayName: string; lockedAt: string };
}

export type ReplaceNodeResult =
  | { node: typeof projectNodes.$inferSelect; version: FileVersion }
  | LockConflictError;

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
}): Promise<ReplaceNodeResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { allowed } = await consumeRateLimit(`files-versions:${user.id}`, 30, 60);
  if (!allowed) throw new Error("Rate limit exceeded");
  await assertProjectUploadAccess(input.projectId, user.id);

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
    await assertProjectUploadAccessTx(tx, input.projectId, user.id);

    // Lock check: query project_node_locks joined with profiles to get displayName
    const now = new Date();
    const lockRows = await tx
      .select({
        lockedBy: projectNodeLocks.lockedBy,
        acquiredAt: projectNodeLocks.acquiredAt,
        displayName: profiles.fullName,
      })
      .from(projectNodeLocks)
      .innerJoin(profiles, eq(profiles.id, projectNodeLocks.lockedBy))
      .where(
        and(
          eq(projectNodeLocks.projectId, input.projectId),
          eq(projectNodeLocks.nodeId, input.nodeId),
          gt(projectNodeLocks.expiresAt, now),
        )
      )
      .limit(1);

    const activeLock = lockRows[0];
    if (activeLock && activeLock.lockedBy !== user.id) {
      return {
        error: "lock_conflict" as const,
        lockedBy: {
          userId: activeLock.lockedBy,
          displayName: activeLock.displayName ?? "Unknown User",
          lockedAt: activeLock.acquiredAt.toISOString(),
        },
      };
    }

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

    return { node: updatedNode!, version: versionRow! };
  });

  // If the transaction returned a lock conflict, return it immediately
  // without recording events or sending notifications.
  if ("error" in result) {
    return result;
  }

  await recordNodeEvent(input.projectId, user.id, input.nodeId, "replace_file_version", {
    version: result.version.version,
    size: normalizedSize,
    mimeType: normalizedMimeType,
    hash: normalizedHash,
  });
  try {
    await notifyForFileVersionCreated({
      actorUserId: user.id,
      projectId: input.projectId,
      nodeId: input.nodeId,
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
  await enqueueProjectFileVersionNotification({
    projectId: input.projectId,
    actorUserId: user.id,
    ...actorNotificationSnapshot(user),
    eventKey: "files.version_added",
    title: `New file version added`,
    body: `Version ${result.version.version} was added to a project file.`,
    sourceEventId: `${input.nodeId}:version:${result.version.version}`,
    entityRefs: {
      projectId: input.projectId,
      fileId: input.nodeId,
    },
  });

  if (result.node) {
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { fullName: true, username: true, avatarUrl: true },
    });
    Object.assign(result.node, {
      updatedById: user.id,
      updatedByName: profile?.fullName ?? null,
      updatedByUsername: profile?.username ?? null,
      updatedByAvatarUrl: profile?.avatarUrl ?? null,
      versionUpdatedAt: result.node.updatedAt,
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

    const [updatedNode] = await tx
      .update(projectNodes)
      .set({
        s3Key: source.s3Key,
        size: source.size,
        mimeType: source.mimeType,
        currentVersion: targetVersion,
        updatedAt: new Date(),
      })
      .where(eq(projectNodes.id, nodeId))
      .returning();

    return { node: updatedNode!, version: source };
  });

  if (result.node) {
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { fullName: true, username: true, avatarUrl: true },
    });
    Object.assign(result.node, {
      updatedById: user.id,
      updatedByName: profile?.fullName ?? null,
      updatedByUsername: profile?.username ?? null,
      updatedByAvatarUrl: profile?.avatarUrl ?? null,
      versionUpdatedAt: result.node.updatedAt,
    });
  }

  await recordNodeEvent(projectId, user.id, nodeId, "restore_file_version", {
    restoredFrom: targetVersion,
    newVersion: targetVersion,
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

export async function getFileVersionContentAction(
  projectId: string,
  nodeId: string,
  versionNumber: number,
): Promise<{ success: true; content: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const actorId = user?.id ?? null;
  await assertProjectFileReadAccess(projectId, actorId);

  const versionRow = await db.query.fileVersions.findFirst({
    where: and(eq(fileVersions.nodeId, nodeId), eq(fileVersions.version, versionNumber)),
    columns: { s3Key: true, size: true }
  });

  if (!versionRow) {
    throw new Error("Version not found");
  }

  const MAX_INLINE_BYTES = 2 * 1024 * 1024; // 2MB cap
  if (versionRow.size > MAX_INLINE_BYTES) {
    throw new Error("File version too large for line diff comparison.");
  }

  const adminClient = await createAdminClient();
  const { data, error } = await adminClient.storage.from("project-files").download(versionRow.s3Key);
  if (error) throw error;
  
  const text = await data.text();
  return { success: true, content: text };
}

export async function deleteFileVersionAction(
  projectId: string,
  nodeId: string,
  versionNumber: number,
): Promise<{ success: boolean; nextActiveVersion?: number | null; node?: typeof projectNodes.$inferSelect }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  
  const { allowed } = await consumeRateLimit(`delete-version:${user.id}`, 30, 60);
  if (!allowed) throw new Error("Rate limit exceeded");

  await assertProjectWriteAccess(projectId, user.id);
  
  const target = await db.query.fileVersions.findFirst({
    where: and(eq(fileVersions.nodeId, nodeId), eq(fileVersions.version, versionNumber)),
  });
  if (!target) throw new Error("Version not found");

  // Prevent deleting the last remaining version to keep file nodes safe
  const allVersions = await db.query.fileVersions.findMany({
    where: eq(fileVersions.nodeId, nodeId),
    orderBy: desc(fileVersions.version),
  });
  if (allVersions.length <= 1) {
    throw new Error("Cannot delete the only remaining version of this file.");
  }

  // Delete from S3
  const adminClient = await createAdminClient();
  await adminClient.storage.from("project-files").remove([target.s3Key]);

  // Delete from db
  await db.delete(fileVersions).where(eq(fileVersions.id, target.id));

  // Check if we deleted the current active version
  const node = await db.query.projectNodes.findFirst({
    where: eq(projectNodes.id, nodeId),
    columns: { currentVersion: true },
  });

  let nextActiveVersion: number | null = null;
  let updatedNode: typeof projectNodes.$inferSelect | undefined = undefined;
  if (node && node.currentVersion === versionNumber) {
    // Find the next highest version available
    const remaining = await db.query.fileVersions.findFirst({
      where: eq(fileVersions.nodeId, nodeId),
      orderBy: desc(fileVersions.version),
    });
    if (remaining) {
      nextActiveVersion = remaining.version;
      const [resNode] = await db
        .update(projectNodes)
        .set({
          s3Key: remaining.s3Key,
          size: remaining.size,
          mimeType: remaining.mimeType,
          currentVersion: remaining.version,
          updatedAt: new Date(),
        })
        .where(eq(projectNodes.id, nodeId))
        .returning();
      updatedNode = resNode;
    }
  }

  await recordNodeEvent(projectId, user.id, nodeId, "delete_file_version", {
    deletedVersion: versionNumber,
    newActiveVersion: nextActiveVersion,
  });

  revalidatePath(`/projects/${projectId}`);
  return { success: true, nextActiveVersion, node: updatedNode };
}

