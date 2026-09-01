"use server";

import { db } from "@/lib/db";
import { fileVersions, profiles, projectNodes, type FileVersion } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
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
  assertTaskFileNodeVisible,
  assertProjectUploadAccess,
  assertProjectWriteAccess,
  assertProjectWriteAccessTx,
  recordNodeEvent,
} from "@/lib/files/internal-helpers";
import { applyFileRevision } from "@/lib/files/apply-file-revision";
import type { FileRevisionMode } from "@/lib/files/revision-policy";
import {
  assertOwnedFileLease,
  type FileLeaseCredentials,
  withTransientFileLease,
} from "@/lib/files/file-lock-service";

/**
 * Server actions for the task-file version history.
 *
 * The lifecycle mirrors `createFileNode` in `mutations.ts` but appends to the
 * existing node instead of creating a sibling. New revisions bump
 * `project_nodes.current_version`; active-revision saves preserve the version
 * number. Both paths update the node and sidecar row in one transaction.
 *
 * Upload-like actions re-verify upload access inside the transaction
 * (`assertProjectUploadAccessTx`) so per-member file-intake toggles cannot be
 * bypassed between signed upload creation and version replacement.
 */

const LIST_VERSIONS_MAX = 200;

async function assertVersionNodeReadable(projectId: string, nodeId: string, actorId: string | null) {
  const access = await assertProjectFileReadAccess(projectId, actorId);
  const node = await db.query.projectNodes.findFirst({
    where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
    columns: { id: true, path: true, taskId: true, deletedAt: true },
  });
  if (!node) throw new Error("File not found");
  assertTaskFileNodeVisible(access, node);
}

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
  const access = await assertProjectFileReadAccess(projectId, actorId);

  // Confirm the node belongs to the project (defense-in-depth on top of RLS).
  const node = await db.query.projectNodes.findFirst({
    where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
    columns: { id: true, type: true, path: true, taskId: true, deletedAt: true },
  });
  if (!node) throw new Error("File not found");
  assertTaskFileNodeVisible(access, node);
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
      attribution: fileVersions.attribution,
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
  await assertVersionNodeReadable(projectId, nodeId, actorId);
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
export async function applyUploadedFileRevision(input: {
  projectId: string;
  nodeId: string;
  s3Key: string;
  size: number;
  mimeType: string;
  contentHash: string | null;
  uploadIntentId?: string;
  comment?: string | null;
  mode: FileRevisionMode;
  baseVersion?: number | null;
  baseHash?: string | null;
  lease: FileLeaseCredentials;
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
  const result = await applyFileRevision({
    projectId: input.projectId,
    nodeId: input.nodeId,
    actorUserId: user.id,
    storageKey: canonicalS3Key,
    size: normalizedSize,
    mimeType: normalizedMimeType,
    contentHash: normalizedHash,
    mode: input.mode,
    comment: input.comment,
    baseVersion: input.baseVersion,
    baseHash: input.baseHash,
    lease: input.lease,
    eventType:
      input.mode === "new_revision"
        ? "replace_file_version"
        : "update_active_file_revision",
    eventMetadata: { source: "files_tab" },
  });

  if (input.mode === "new_revision") {
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
  }

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
  return { node: result.node, version: result.version };
}

export async function replaceNodeWithNewVersion(
  input: Omit<Parameters<typeof applyUploadedFileRevision>[0], "mode">,
): Promise<ReplaceNodeResult> {
  return applyUploadedFileRevision({ ...input, mode: "new_revision" });
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

  const result = await withTransientFileLease(
    { projectId, nodeId, userId: user.id },
    async (lease) => {
      const source = await db.query.fileVersions.findFirst({
        where: and(
          eq(fileVersions.nodeId, nodeId),
          eq(fileVersions.version, targetVersion),
        ),
      });
      if (!source) throw new Error("Version not found");

      return applyFileRevision({
        projectId,
        nodeId,
        actorUserId: user.id,
        storageKey: source.s3Key,
        size: source.size,
        mimeType: source.mimeType,
        contentHash: source.contentHash,
        mode: "new_revision",
        comment: `Restored from version ${targetVersion}`,
        lease,
        accessRequirement: "write",
        eventType: "restore_file_version",
        eventMetadata: { restoredFrom: targetVersion },
      });
    },
  );

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
  await assertVersionNodeReadable(projectId, nodeId, actorId);

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
  
  const mutation = await withTransientFileLease(
    { projectId, nodeId, userId: user.id },
    (lease) => db.transaction(async (tx) => {
      await assertProjectWriteAccessTx(tx, projectId, user.id);
      await tx.execute(sql`SELECT id FROM project_nodes WHERE id = ${nodeId} FOR UPDATE`);
      await assertOwnedFileLease(tx, { projectId, nodeId, userId: user.id, credentials: lease });
      const node = await tx.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
      });
      if (!node || node.deletedAt) throw new Error("File not found");
      const versions = await tx.query.fileVersions.findMany({
        where: eq(fileVersions.nodeId, nodeId),
        orderBy: desc(fileVersions.version),
      });
      if (versions.length <= 1) throw new Error("Cannot delete the only remaining version of this file.");
      const target = versions.find((version) => version.version === versionNumber);
      if (!target) throw new Error("Version not found");
      await tx.delete(fileVersions).where(eq(fileVersions.id, target.id));

      let nextActiveVersion: number | null = null;
      let updatedNode: typeof projectNodes.$inferSelect | undefined;
      if (node.currentVersion === versionNumber) {
        const remaining = versions.filter((version) => version.id !== target.id)[0];
        if (!remaining) throw new Error("No replacement version is available");
        nextActiveVersion = remaining.version;
        [updatedNode] = await tx
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
      }
      return { target, nextActiveVersion, updatedNode };
    }),
  );

  const [versionReference, nodeReference] = await Promise.all([
    db.query.fileVersions.findFirst({ where: eq(fileVersions.s3Key, mutation.target.s3Key), columns: { id: true } }),
    db.query.projectNodes.findFirst({ where: eq(projectNodes.s3Key, mutation.target.s3Key), columns: { id: true } }),
  ]);
  // Copies and trashed files may still refer to a blob without a version row.
  if (!versionReference && !nodeReference && parseProjectFileKey(mutation.target.s3Key)?.projectId === projectId) {
    const adminClient = await createAdminClient();
    await adminClient.storage.from("project-files").remove([mutation.target.s3Key]).catch(() => null);
  }

  await recordNodeEvent(projectId, user.id, nodeId, "delete_file_version", {
    deletedVersion: versionNumber,
    newActiveVersion: mutation.nextActiveVersion,
  });

  revalidatePath(`/projects/${projectId}`);
  return { success: true, nextActiveVersion: mutation.nextActiveVersion, node: mutation.updatedNode };
}
