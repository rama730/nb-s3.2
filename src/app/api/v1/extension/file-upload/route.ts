import crypto from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { enforceRouteLimit, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import {
  assertNoExtensionWriteConflict,
  buildExtensionRevisionStorageKey,
  checksumSchema,
  extensionRevisionConflictResponse,
  extensionRevisionData,
  parseExtensionLeaseMetadata,
  resolveWritableExtensionFile,
} from "@/app/api/v1/extension/_file-revision";
import { db } from "@/lib/db";
import { fileVersions, projectNodes, uploadIntents } from "@/lib/db/schema";
import { recordExtensionMetric } from "@/lib/extension/observability";
import { applyFileRevision } from "@/lib/files/apply-file-revision";
import { FILE_REVISION_MODES, normalizeRevisionComment, parseFileRevisionMode } from "@/lib/files/revision-policy";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/server";
import { createUploadIntent } from "@/lib/upload/upload-intents";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const intentSchema = z.object({
  action: z.literal("intent"),
  projectId: z.string().uuid(),
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  mimeType: z.string().min(1).max(180),
  contentHash: checksumSchema,
  baseVersion: z.number().int().positive().optional().nullable(),
  baseHash: checksumSchema.optional().nullable(),
  revisionMode: z.enum(FILE_REVISION_MODES).optional().default("new_revision"),
  comment: z.string().max(500).optional().nullable(),
  operationId: z.string().min(8).max(200).optional().nullable(),
  leaseId: z.string().uuid(),
  clientSessionId: z.string().uuid(),
  fencingToken: z.number().int().positive(),
});

const finalizeSchema = z.object({
  action: z.literal("finalize"),
  uploadIntentId: z.string().uuid(),
  checksum: checksumSchema,
});

function readIntentMetadata(intent: typeof uploadIntents.$inferSelect) {
  return intent.metadata && typeof intent.metadata === "object"
    ? intent.metadata as Record<string, unknown>
    : {};
}

async function recoverFinalizedIntent(intent: typeof uploadIntents.$inferSelect) {
  const metadata = readIntentMetadata(intent);
  const nodeId = typeof metadata.nodeId === "string" ? metadata.nodeId : "";
  const revisionMode = parseFileRevisionMode(metadata.revisionMode);
  if (!nodeId) return null;

  const version = await db.query.fileVersions.findFirst({
    where: and(
      eq(fileVersions.nodeId, nodeId),
      eq(fileVersions.s3Key, intent.storageKey),
    ),
    orderBy: [desc(fileVersions.version)],
  });
  const node = await db.query.projectNodes.findFirst({
    where: eq(projectNodes.id, nodeId),
  });
  if (!version || !node) return null;

  return {
    nodeId,
    version: version.version,
    size: version.size,
    mimeType: version.mimeType,
    contentHash: version.contentHash,
    syncStatus: node.syncStatus,
    sequenceNumber: null,
    revisionMode,
    versionIncremented: revisionMode === "new_revision",
    updatedAt: node.updatedAt?.toISOString?.() ?? node.updatedAt,
  };
}

async function markIntentFailed(uploadIntentId: string, failureReason: string) {
  await db
    .update(uploadIntents)
    .set({
      status: "failed",
      failureReason,
      updatedAt: new Date(),
    })
    .where(eq(uploadIntents.id, uploadIntentId));
}

async function handleIntent(userId: string, body: z.infer<typeof intentSchema>) {
  const startedAt = Date.now();
  const resolved = await resolveWritableExtensionFile(body.projectId, body.path, userId);
  if (resolved.response) return resolved.response;
  const node = resolved.node!;

  if (body.operationId) {
    const previousIntent = await db.query.uploadIntents.findFirst({
      where: and(
        eq(uploadIntents.userId, userId),
        eq(uploadIntents.projectId, body.projectId),
        sql`${uploadIntents.metadata} ->> 'operationId' = ${body.operationId}`,
      ),
      orderBy: [desc(uploadIntents.createdAt)],
    });
    if (previousIntent) {
      const previousMetadata = readIntentMetadata(previousIntent);
      if (
        previousMetadata.path !== body.path ||
        previousMetadata.contentHash !== body.contentHash.toLowerCase() ||
        parseFileRevisionMode(previousMetadata.revisionMode) !== body.revisionMode
      ) {
        return jsonError(
          "Operation id was already used for different file content",
          409,
          "CONFLICT",
        );
      }
    }
    if (previousIntent?.status === "finalized") {
      const finalizedResult = await recoverFinalizedIntent(previousIntent);
      if (finalizedResult) {
        return jsonSuccess({
          alreadyFinalized: true,
          finalizedResult,
          uploadIntentId: previousIntent.id,
        });
      }
    }
    if (previousIntent?.status === "pending" && previousIntent.expiresAt.getTime() > Date.now()) {
      const adminClient = await createAdminClient();
      const { data: uploadSession, error } = await adminClient.storage
        .from(previousIntent.bucket)
        .createSignedUploadUrl(previousIntent.storageKey);
      if (!error && uploadSession) {
        return jsonSuccess({
          uploadIntentId: previousIntent.id,
          signedUrl: uploadSession.signedUrl,
          uploadToken: uploadSession.token,
          storagePath: previousIntent.storageKey,
          bucket: previousIntent.bucket,
          contentType: previousIntent.expectedMimeType,
          expiresAt: previousIntent.expiresAt.toISOString(),
        });
      }
    }
  }

  const conflict = await assertNoExtensionWriteConflict({
    node,
    baseVersion: body.baseVersion,
    baseHash: body.baseHash,
  });
  if (conflict) return conflict;

  const contentHash = body.contentHash.toLowerCase();
  const storageKey = buildExtensionRevisionStorageKey(body.projectId, node.id, body.path, contentHash);
  const bucket = "project-files";
  const adminClient = await createAdminClient();
  const { data: uploadSession, error: storageError } = await adminClient.storage
    .from(bucket)
    .createSignedUploadUrl(storageKey);

  if (storageError || !uploadSession) {
    logger.error("[api/v1/extension/file-upload] signed upload url failed", {
      error: storageError?.message || "missing upload session",
      projectId: body.projectId,
      nodeId: node.id,
    });
    return jsonError("Failed to create upload URL", 500, "INTERNAL_ERROR");
  }

  const intent = await createUploadIntent({
    userId,
    projectId: body.projectId,
    bucket,
    storageKey,
    scope: "project_file",
    kind: "file",
    expectedMimeType: body.mimeType,
    expectedSize: body.size,
    metadata: {
      source: "extension_large_file",
      nodeId: node.id,
      path: body.path,
      fileName: node.name,
      baseVersion: body.baseVersion ?? node.currentVersion,
      baseHash: body.baseHash ?? null,
      contentHash,
      revisionMode: body.revisionMode,
      comment: normalizeRevisionComment(body.comment),
      operationId: body.operationId ?? null,
      leaseId: body.leaseId,
      clientSessionId: body.clientSessionId,
      fencingToken: body.fencingToken,
    },
  });

  recordExtensionMetric("extension.file_upload.intent", {
    action: "intent",
    success: true,
    userId,
    projectId: body.projectId,
    nodeId: node.id,
    uploadIntentId: intent.id,
    path: body.path,
    sizeBytes: body.size,
    revisionMode: body.revisionMode,
    durationMs: Date.now() - startedAt,
  });

  return jsonSuccess({
    uploadIntentId: intent.id,
    signedUrl: uploadSession.signedUrl,
    uploadToken: uploadSession.token,
    storagePath: storageKey,
    bucket,
    contentType: intent.expectedMimeType,
    expiresAt: intent.expiresAt.toISOString(),
  });
}

async function handleFinalize(userId: string, body: z.infer<typeof finalizeSchema>) {
  const startedAt = Date.now();
  const intent = await db.query.uploadIntents.findFirst({
    where: and(
      eq(uploadIntents.id, body.uploadIntentId),
      eq(uploadIntents.userId, userId),
    ),
  });

  if (!intent) {
    return jsonError("Upload intent not found or already finalized", 404, "NOT_FOUND");
  }
  const metadata = readIntentMetadata(intent);
  const nodeId = typeof metadata.nodeId === "string" ? metadata.nodeId : "";
  const path = typeof metadata.path === "string" ? metadata.path : "";
  const contentHash = typeof metadata.contentHash === "string" ? metadata.contentHash.toLowerCase() : "";
  if (!nodeId || !path || !contentHash || contentHash !== body.checksum.toLowerCase()) {
    if (intent.status === "pending") {
      await markIntentFailed(intent.id, "Upload intent metadata mismatch");
    }
    return jsonError("Upload intent metadata mismatch", 400, "BAD_REQUEST");
  }
  if (intent.status === "finalized") {
    const recovered = await recoverFinalizedIntent(intent);
    if (recovered) return jsonSuccess(recovered);
    return jsonError("Finalized upload result is unavailable", 409, "CONFLICT");
  }
  if (intent.status !== "pending") {
    return jsonError("Upload intent is not pending", 409, "CONFLICT");
  }
  if (intent.expiresAt.getTime() <= Date.now()) {
    await markIntentFailed(intent.id, "Upload intent expired");
    return jsonError("Upload intent expired", 409, "CONFLICT");
  }
  if (!intent.projectId) {
    await markIntentFailed(intent.id, "Upload intent is missing project id");
    return jsonError("Invalid upload intent", 400, "BAD_REQUEST");
  }

  const baseVersion = typeof metadata.baseVersion === "number" ? metadata.baseVersion : null;
  const baseHash = typeof metadata.baseHash === "string" ? metadata.baseHash : null;
  const revisionMode = parseFileRevisionMode(metadata.revisionMode);
  const comment = normalizeRevisionComment(metadata.comment);
  const operationId = typeof metadata.operationId === "string" ? metadata.operationId : null;
  const lease = parseExtensionLeaseMetadata(metadata);
  if (!lease) {
    await markIntentFailed(intent.id, "Upload intent is missing editing lease metadata");
    return jsonError("A valid editing lease is required", 409, "CONFLICT");
  }
  const resolved = await resolveWritableExtensionFile(intent.projectId, path, userId);
  if (resolved.response) return resolved.response;
  if (resolved.node!.id !== nodeId) {
    await markIntentFailed(intent.id, "Upload intent metadata mismatch");
    return jsonError("Upload intent metadata mismatch", 400, "BAD_REQUEST");
  }

  const conflict = await assertNoExtensionWriteConflict({
    node: resolved.node!,
    baseVersion,
    baseHash,
  });
  if (conflict) {
    await markIntentFailed(intent.id, "Write conflict during finalize");
    return conflict;
  }

  const adminClient = await createAdminClient();
  const { data: info, error: infoError } = await adminClient.storage.from(intent.bucket).info(intent.storageKey);
  if (infoError || !info) {
    await markIntentFailed(intent.id, infoError?.message || "Uploaded object missing");
    return jsonError("Uploaded object not found in storage", 404, "NOT_FOUND");
  }

  if (info.size !== intent.expectedSize) {
    await markIntentFailed(intent.id, "Uploaded object size mismatch");
    return jsonError("File size mismatch", 400, "BAD_REQUEST");
  }

  let result;
  try {
    result = await applyFileRevision({
      projectId: intent.projectId,
      nodeId,
      actorUserId: userId,
      storageKey: intent.storageKey,
      size: intent.expectedSize,
      mimeType: intent.expectedMimeType,
      contentHash,
      mode: revisionMode,
      comment,
      baseVersion,
      baseHash,
      lease,
      eventType: "extension_file_saved",
      eventMetadata: {
        uploadIntentId: intent.id,
        transfer: "signed_upload",
        operationId,
      },
      syncStatus: "merged",
      afterMutationTx: async (tx) => {
        await tx
          .update(uploadIntents)
          .set({
            status: "finalized",
            finalizedMimeType: intent.expectedMimeType,
            finalizedSize: intent.expectedSize,
            finalizedAt: new Date(),
            failureReason: null,
            updatedAt: new Date(),
          })
          .where(eq(uploadIntents.id, intent.id));
      },
    });
  } catch (error) {
    await markIntentFailed(
      intent.id,
      error instanceof Error ? error.message : "Failed to apply revision",
    );
    const conflictResponse = extensionRevisionConflictResponse(error);
    if (conflictResponse) return conflictResponse;
    throw error;
  }

  recordExtensionMetric("extension.file_upload.finalize", {
    action: "finalize",
    success: true,
    userId,
    projectId: intent.projectId,
    nodeId,
    uploadIntentId: intent.id,
    path,
    sizeBytes: intent.expectedSize,
    revisionMode: result.mode,
    versionIncremented: result.versionIncremented,
    durationMs: Date.now() - startedAt,
  });

  return jsonSuccess(extensionRevisionData(result, contentHash));
}

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  const limitResponse = await enforceRouteLimit(request, "api:v1:extension:file-upload", 60, 60);
  if (limitResponse) return limitResponse;

  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) return authResult.response;
    const user = authResult.user;
    if (!user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");
    if (!authResult.extensionSessionId) {
      return jsonError("An active extension device session is required", 401, "UNAUTHORIZED");
    }

    const body = await request.json().catch(() => null);
    const intent = intentSchema.safeParse(body);
    if (intent.success) {
      return await handleIntent(user.id, intent.data);
    }
    const finalize = finalizeSchema.safeParse(body);
    if (finalize.success) {
      return await handleFinalize(user.id, finalize.data);
    }
    return jsonError("Invalid upload request", 400, "BAD_REQUEST");
  } catch (error) {
    logger.error("[api/v1/extension/file-upload] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(
      "Failed to save file revision. Refresh the file and try again.",
      500,
      "INTERNAL_ERROR",
    );
  }
}
