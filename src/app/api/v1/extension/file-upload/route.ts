import crypto from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import { enforceRouteLimit, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { fileVersions, profiles, projectNodeLocks, projectNodes, uploadIntents } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { recordExtensionMetric } from "@/lib/extension/observability";
import { recordNodeEvent } from "@/lib/files/internal-helpers";
import { logger } from "@/lib/logger";
import { buildProjectFileKey } from "@/lib/storage/project-file-key";
import { createAdminClient } from "@/lib/supabase/server";
import { createUploadIntent } from "@/lib/upload/upload-intents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/i);

const intentSchema = z.object({
  action: z.literal("intent"),
  projectId: z.string().uuid(),
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  mimeType: z.string().min(1).max(180),
  contentHash: checksumSchema,
  baseVersion: z.number().int().positive().optional().nullable(),
  baseHash: checksumSchema.optional().nullable(),
});

const finalizeSchema = z.object({
  action: z.literal("finalize"),
  uploadIntentId: z.string().uuid(),
  checksum: checksumSchema,
});

function inferExtensionSuffix(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension && /^[a-z0-9]{1,16}$/.test(extension) ? `.${extension}` : "";
}

function readIntentMetadata(intent: typeof uploadIntents.$inferSelect) {
  return intent.metadata && typeof intent.metadata === "object"
    ? intent.metadata as Record<string, unknown>
    : {};
}

async function resolveWritableNode(projectId: string, path: string, userId: string) {
  const access = await getProjectAccessById(projectId, userId);
  if (!access.project) return { error: jsonError("Project not found", 404, "NOT_FOUND") };
  if (!access.canWrite) return { error: jsonError("Forbidden", 403, "FORBIDDEN") };

  const node = await db.query.projectNodes.findFirst({
    where: and(
      eq(projectNodes.projectId, projectId),
      eq(projectNodes.path, path),
      eq(projectNodes.type, "file"),
      isNull(projectNodes.deletedAt),
    ),
  });

  if (!node) return { error: jsonError("File node not found", 404, "NOT_FOUND") };
  return { node };
}

async function assertNoWriteConflict(params: {
  projectId: string;
  nodeId: string;
  userId: string;
  baseVersion?: number | null;
  baseHash?: string | null;
}) {
  const node = await db.query.projectNodes.findFirst({
    where: and(
      eq(projectNodes.id, params.nodeId),
      eq(projectNodes.projectId, params.projectId),
      eq(projectNodes.type, "file"),
      isNull(projectNodes.deletedAt),
    ),
  });
  if (!node) {
    return jsonError("File node not found", 404, "NOT_FOUND");
  }

  if (params.baseVersion && params.baseVersion !== node.currentVersion) {
    return jsonError("File changed on the server. Refresh before saving again.", 409, "CONFLICT");
  }

  if (params.baseHash) {
    const currentVersion = await db.query.fileVersions.findFirst({
      where: and(eq(fileVersions.nodeId, node.id), eq(fileVersions.version, node.currentVersion)),
      columns: { contentHash: true },
    });
    if (currentVersion?.contentHash && currentVersion.contentHash !== params.baseHash) {
      return jsonError("File content changed on the server. Refresh before saving again.", 409, "CONFLICT");
    }
  }

  const activeLock = await db.query.projectNodeLocks.findFirst({
    where: and(
      eq(projectNodeLocks.projectId, params.projectId),
      eq(projectNodeLocks.nodeId, params.nodeId),
      gt(projectNodeLocks.expiresAt, new Date()),
    ),
  });

  if (activeLock && activeLock.lockedBy !== params.userId) {
    const lockHolder = await db.query.profiles.findFirst({
      where: eq(profiles.id, activeLock.lockedBy),
      columns: { fullName: true, username: true },
    });
    return jsonError(
      `File is locked by ${lockHolder?.fullName || lockHolder?.username || "another collaborator"}.`,
      423,
      "CONFLICT",
    );
  }

  return null;
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
  const resolved = await resolveWritableNode(body.projectId, body.path, userId);
  if (resolved.error) return resolved.error;
  const node = resolved.node!;

  const conflict = await assertNoWriteConflict({
    projectId: body.projectId,
    nodeId: node.id,
    userId,
    baseVersion: body.baseVersion,
    baseHash: body.baseHash,
  });
  if (conflict) return conflict;

  const contentHash = body.contentHash.toLowerCase();
  const storageKey = buildProjectFileKey(
    body.projectId,
    `nodes/${node.id}/versions/${contentHash}-${crypto.randomUUID()}${inferExtensionSuffix(body.path)}`,
  );
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

  if (!intent || intent.status !== "pending") {
    return jsonError("Upload intent not found or already finalized", 404, "NOT_FOUND");
  }
  if (intent.expiresAt.getTime() <= Date.now()) {
    await markIntentFailed(intent.id, "Upload intent expired");
    return jsonError("Upload intent expired", 409, "CONFLICT");
  }
  if (!intent.projectId) {
    await markIntentFailed(intent.id, "Upload intent is missing project id");
    return jsonError("Invalid upload intent", 400, "BAD_REQUEST");
  }

  const metadata = readIntentMetadata(intent);
  const nodeId = typeof metadata.nodeId === "string" ? metadata.nodeId : "";
  const path = typeof metadata.path === "string" ? metadata.path : "";
  const contentHash = typeof metadata.contentHash === "string" ? metadata.contentHash.toLowerCase() : "";
  const baseVersion = typeof metadata.baseVersion === "number" ? metadata.baseVersion : null;
  const baseHash = typeof metadata.baseHash === "string" ? metadata.baseHash : null;
  if (!nodeId || !path || !contentHash || contentHash !== body.checksum.toLowerCase()) {
    await markIntentFailed(intent.id, "Upload intent metadata mismatch");
    return jsonError("Upload intent metadata mismatch", 400, "BAD_REQUEST");
  }

  const access = await getProjectAccessById(intent.projectId, userId);
  if (!access.project) return jsonError("Project not found", 404, "NOT_FOUND");
  if (!access.canWrite) return jsonError("Forbidden", 403, "FORBIDDEN");

  const conflict = await assertNoWriteConflict({
    projectId: intent.projectId,
    nodeId,
    userId,
    baseVersion,
    baseHash,
  });
  if (conflict) {
    await markIntentFailed(intent.id, "Write conflict during finalize");
    return conflict;
  }

  const adminClient = await createAdminClient();
  const { data, error } = await adminClient.storage.from(intent.bucket).download(intent.storageKey);
  if (error || !data) {
    await markIntentFailed(intent.id, error?.message || "Uploaded object missing");
    return jsonError("Uploaded object not found in storage", 404, "NOT_FOUND");
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  if (buffer.byteLength !== intent.expectedSize) {
    await markIntentFailed(intent.id, "Uploaded object size mismatch");
    return jsonError("File size mismatch", 400, "BAD_REQUEST");
  }
  const actualHash = crypto.createHash("sha256").update(buffer).digest("hex");
  if (actualHash !== contentHash) {
    await markIntentFailed(intent.id, "Uploaded object checksum mismatch");
    return jsonError("Checksum mismatch", 400, "BAD_REQUEST");
  }

  const result = await db.transaction(async (tx) => {
    const current = await tx.query.projectNodes.findFirst({
      where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, intent.projectId!)),
      columns: { currentVersion: true },
    });
    const nextVersion = (current?.currentVersion ?? 1) + 1;

    const [versionRow] = await tx
      .insert(fileVersions)
      .values({
        nodeId,
        version: nextVersion,
        s3Key: intent.storageKey,
        size: intent.expectedSize,
        mimeType: intent.expectedMimeType,
        contentHash,
        uploadedBy: userId,
      })
      .returning();

    const [updatedNode] = await tx
      .update(projectNodes)
      .set({
        s3Key: intent.storageKey,
        size: intent.expectedSize,
        mimeType: intent.expectedMimeType,
        currentVersion: nextVersion,
        gitHash: contentHash,
        syncStatus: "merged",
        updatedAt: new Date(),
      })
      .where(eq(projectNodes.id, nodeId))
      .returning();

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

    const eventResult = await recordNodeEvent(intent.projectId!, userId, nodeId, "extension_file_saved", {
      version: nextVersion,
      size: intent.expectedSize,
      mimeType: intent.expectedMimeType,
      hash: contentHash,
      uploadIntentId: intent.id,
      transfer: "signed_upload",
    }, tx);

    return {
      node: updatedNode!,
      version: versionRow!,
      sequenceNumber: eventResult.sequenceNumber,
    };
  });

  recordExtensionMetric("extension.file_upload.finalize", {
    action: "finalize",
    success: true,
    userId,
    projectId: intent.projectId,
    nodeId,
    uploadIntentId: intent.id,
    path,
    sizeBytes: intent.expectedSize,
    durationMs: Date.now() - startedAt,
  });

  return jsonSuccess({
    nodeId: result.node.id,
    version: result.version.version,
    size: result.node.size,
    mimeType: result.node.mimeType,
    contentHash,
    syncStatus: result.node.syncStatus,
    sequenceNumber: result.sequenceNumber,
    updatedAt: result.node.updatedAt?.toISOString?.() ?? result.node.updatedAt,
  });
}

export async function POST(request: Request) {
  const limitResponse = await enforceRouteLimit(request, "api:v1:extension:file-upload", 60, 60);
  if (limitResponse) return limitResponse;

  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) return authResult.response;
    const user = authResult.user;
    if (!user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

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
      error instanceof Error ? error.message : "Extension upload failed",
      500,
      "INTERNAL_ERROR",
    );
  }
}
