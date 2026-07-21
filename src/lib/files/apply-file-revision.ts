import "server-only";

import { and, eq, max, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { fileVersions, projectNodes, type FileVersion } from "@/lib/db/schema";
import {
  assertProjectUploadAccessTx,
  assertProjectWriteAccessTx,
  recordNodeEvent,
} from "@/lib/files/internal-helpers";
import { assertOwnedFileLease, type FileLeaseCredentials } from "@/lib/files/file-lock-service";
import {
  normalizeRevisionComment,
  nextFileRevisionNumber,
  type FileRevisionMode,
} from "@/lib/files/revision-policy";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/server";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ApplyFileRevisionInput {
  projectId: string;
  nodeId: string;
  actorUserId: string;
  storageKey: string;
  size: number;
  mimeType: string;
  contentHash: string | null;
  mode: FileRevisionMode;
  comment?: string | null;
  baseVersion?: number | null;
  baseHash?: string | null;
  lease: FileLeaseCredentials;
  eventType?: string;
  eventMetadata?: Record<string, unknown>;
  syncStatus?: string;
  accessRequirement?: "upload" | "write";
  afterMutationTx?: (tx: DbTransaction) => Promise<void>;
}

export interface ApplyFileRevisionResult {
  node: typeof projectNodes.$inferSelect;
  version: FileVersion;
  mode: FileRevisionMode;
  versionIncremented: boolean;
  replacedStorageKey: string | null;
  sequenceNumber: number;
}

/**
 * Canonical file-revision mutation used by the browser and extension APIs.
 *
 * The project and node rows are locked in the same transaction as the version
 * write. New revisions append a row and increment currentVersion; active
 * revisions update the current row while preserving its version number.
 */
export async function applyFileRevision(
  input: ApplyFileRevisionInput,
): Promise<ApplyFileRevisionResult> {
  const result = await db.transaction(async (tx) => {
    if (input.accessRequirement === "write") {
      await assertProjectWriteAccessTx(tx, input.projectId, input.actorUserId);
    } else {
      await assertProjectUploadAccessTx(tx, input.projectId, input.actorUserId);
    }
    await tx.execute(sql`
      SELECT id
      FROM project_nodes
      WHERE id = ${input.nodeId}
        AND project_id = ${input.projectId}
      FOR UPDATE
    `);
    await assertOwnedFileLease(tx, {
      projectId: input.projectId,
      nodeId: input.nodeId,
      userId: input.actorUserId,
      credentials: input.lease,
    });

    const current = await tx.query.projectNodes.findFirst({
      where: and(
        eq(projectNodes.id, input.nodeId),
        eq(projectNodes.projectId, input.projectId),
      ),
    });
    if (!current || current.deletedAt) throw new Error("File not found");
    if (current.type !== "file") throw new Error("Only file nodes support revisions");

    const currentVersionNumber = current.currentVersion ?? 1;
    if (input.baseVersion != null && input.baseVersion !== currentVersionNumber) {
      throw new Error("File changed on the server. Refresh before saving again.");
    }

    const currentVersion = await tx.query.fileVersions.findFirst({
      where: and(
        eq(fileVersions.nodeId, input.nodeId),
        eq(fileVersions.version, currentVersionNumber),
      ),
    });
    if (
      input.baseHash &&
      currentVersion?.contentHash &&
      input.baseHash !== currentVersion.contentHash
    ) {
      throw new Error("File content changed on the server. Refresh before saving again.");
    }

    const comment = normalizeRevisionComment(input.comment);
    const now = new Date();
    const [history] = await tx
      .select({ highestVersion: max(fileVersions.version) })
      .from(fileVersions)
      .where(eq(fileVersions.nodeId, input.nodeId));
    const versionNumber =
      input.mode === "new_revision"
        ? nextFileRevisionNumber(currentVersionNumber, history?.highestVersion)
        : currentVersionNumber;

    let version: FileVersion;
    if (input.mode === "new_revision") {
      const [inserted] = await tx
        .insert(fileVersions)
        .values({
          nodeId: input.nodeId,
          version: versionNumber,
          s3Key: input.storageKey,
          size: input.size,
          mimeType: input.mimeType,
          contentHash: input.contentHash,
          uploadedBy: input.actorUserId,
          comment,
          uploadedAt: now,
        })
        .returning();
      if (!inserted) throw new Error("Failed to create file revision");
      version = inserted;
    } else if (currentVersion) {
      const [updated] = await tx
        .update(fileVersions)
        .set({
          s3Key: input.storageKey,
          size: input.size,
          mimeType: input.mimeType,
          contentHash: input.contentHash,
          uploadedBy: input.actorUserId,
          uploadedAt: now,
          ...(comment !== null ? { comment } : {}),
        })
        .where(eq(fileVersions.id, currentVersion.id))
        .returning();
      if (!updated) throw new Error("Failed to update active revision");
      version = updated;
    } else {
      const [inserted] = await tx
        .insert(fileVersions)
        .values({
          nodeId: input.nodeId,
          version: currentVersionNumber,
          s3Key: input.storageKey,
          size: input.size,
          mimeType: input.mimeType,
          contentHash: input.contentHash,
          uploadedBy: input.actorUserId,
          comment,
          uploadedAt: now,
        })
        .returning();
      if (!inserted) throw new Error("Failed to initialize active revision");
      version = inserted;
    }

    const [updatedNode] = await tx
      .update(projectNodes)
      .set({
        s3Key: input.storageKey,
        size: input.size,
        mimeType: input.mimeType,
        currentVersion: versionNumber,
        ...(input.syncStatus ? { syncStatus: input.syncStatus } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(projectNodes.id, input.nodeId),
          eq(projectNodes.projectId, input.projectId),
        ),
      )
      .returning();
    if (!updatedNode) throw new Error("Failed to update file node");

    await input.afterMutationTx?.(tx);

    const event = await recordNodeEvent(
      input.projectId,
      input.actorUserId,
      input.nodeId,
      input.eventType ?? "file_revision_applied",
      {
        revisionMode: input.mode,
        version: versionNumber,
        versionIncremented: input.mode === "new_revision",
        size: input.size,
        mimeType: input.mimeType,
        hash: input.contentHash,
        leaseId: input.lease.leaseId,
        fencingToken: input.lease.fencingToken,
        comment,
        ...input.eventMetadata,
      },
      tx,
    );

    return {
      node: updatedNode,
      version,
      mode: input.mode,
      versionIncremented: input.mode === "new_revision",
      replacedStorageKey:
        input.mode === "active_revision" && current.s3Key !== input.storageKey
          ? current.s3Key
          : null,
      sequenceNumber: event.sequenceNumber,
    };
  });

  if (result.replacedStorageKey) {
    const stillReferenced = await db.query.fileVersions.findFirst({
      where: eq(fileVersions.s3Key, result.replacedStorageKey),
      columns: { id: true },
    });
    if (!stillReferenced) {
      try {
        const storage = await createAdminClient();
        const { error } = await storage.storage
          .from("project-files")
          .remove([result.replacedStorageKey]);
        if (error) throw error;
      } catch (error) {
        logger.warn("files.revision.orphan_cleanup_failed", {
          module: "files",
          projectId: input.projectId,
          nodeId: input.nodeId,
          storageKey: result.replacedStorageKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return result;
}
