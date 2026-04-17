import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { uploadIntents, type UploadIntent } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";
import {
  normalizeAndValidateFileSize,
  normalizeAndValidateMimeType,
  validateUploadedBlobMagicBytes,
} from "@/lib/upload/security";

const DEFAULT_UPLOAD_INTENT_TTL_MS = 60 * 60 * 1000;

export type UploadIntentScope = "project_file" | "profile_image";
export type UploadIntentKind = "file" | "avatar" | "banner";
export type UploadIntentStatus = "pending" | "finalized" | "expired" | "failed";

function resolveUploadIntentExpiry() {
  return new Date(Date.now() + DEFAULT_UPLOAD_INTENT_TTL_MS);
}

function assertPendingIntent(intent: UploadIntent) {
  if (intent.status === "finalized") {
    return;
  }
  if (intent.expiresAt.getTime() <= Date.now()) {
    throw new Error("Upload intent expired");
  }
  if (intent.status !== "pending") {
    throw new Error("Upload intent is no longer usable");
  }
}

async function markIntentFailure(intentId: string, reason: string) {
  await db
    .update(uploadIntents)
    .set({
      status: "failed",
      failureReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(uploadIntents.id, intentId));
}

export async function createUploadIntent(params: {
  userId: string;
  projectId?: string | null;
  bucket: string;
  storageKey: string;
  scope: UploadIntentScope;
  kind: UploadIntentKind;
  expectedMimeType: string;
  expectedSize: number;
  metadata?: Record<string, unknown>;
}) {
  const expectedMimeType = normalizeAndValidateMimeType(params.expectedMimeType);
  const expectedSize = normalizeAndValidateFileSize(params.expectedSize, Number.MAX_SAFE_INTEGER, "Upload");
  const expiresAt = resolveUploadIntentExpiry();

  const [intent] = await db
    .insert(uploadIntents)
    .values({
      userId: params.userId,
      projectId: params.projectId ?? null,
      bucket: params.bucket,
      storageKey: params.storageKey,
      scope: params.scope,
      kind: params.kind,
      expectedMimeType,
      expectedSize,
      metadata: params.metadata ?? {},
      status: "pending",
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [uploadIntents.bucket, uploadIntents.storageKey],
      set: {
        userId: params.userId,
        projectId: params.projectId ?? null,
        scope: params.scope,
        kind: params.kind,
        expectedMimeType,
        expectedSize,
        metadata: params.metadata ?? {},
        status: "pending",
        failureReason: null,
        finalizedMimeType: null,
        finalizedSize: null,
        finalizedAt: null,
        expiresAt,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!intent) {
    throw new Error("Failed to create upload intent");
  }

  return intent;
}

export async function getUploadIntentById(params: {
  intentId: string;
  userId: string;
}) {
  return await db.query.uploadIntents.findFirst({
    where: and(eq(uploadIntents.id, params.intentId), eq(uploadIntents.userId, params.userId)),
  });
}

export async function getUploadIntentByStorageKey(params: {
  bucket: string;
  storageKey: string;
  userId: string;
  projectId?: string | null;
}) {
  const projectFilter =
    params.projectId === undefined
      ? undefined
      : params.projectId === null
        ? isNull(uploadIntents.projectId)
        : eq(uploadIntents.projectId, params.projectId);

  return await db.query.uploadIntents.findFirst({
    where: and(
      eq(uploadIntents.bucket, params.bucket),
      eq(uploadIntents.storageKey, params.storageKey),
      eq(uploadIntents.userId, params.userId),
      projectFilter,
    ),
  });
}

export async function finalizeUploadIntent(params: {
  intentId?: string;
  bucket: string;
  storageKey?: string;
  userId: string;
  projectId?: string | null;
  expectedScope?: UploadIntentScope;
  expectedKind?: UploadIntentKind;
}) {
  const intent = params.intentId
    ? await getUploadIntentById({ intentId: params.intentId, userId: params.userId })
    : params.storageKey
      ? await getUploadIntentByStorageKey({
          bucket: params.bucket,
          storageKey: params.storageKey,
          userId: params.userId,
          projectId: params.projectId,
        })
      : null;

  if (!intent) {
    throw new Error("Upload intent not found");
  }

  if (params.expectedScope && intent.scope !== params.expectedScope) {
    throw new Error("Upload intent scope mismatch");
  }
  if (params.expectedKind && intent.kind !== params.expectedKind) {
    throw new Error("Upload intent kind mismatch");
  }
  if (params.projectId !== undefined && intent.projectId !== (params.projectId ?? null)) {
    throw new Error("Upload intent project mismatch");
  }

  if (intent.status === "finalized") {
    return intent;
  }

  assertPendingIntent(intent);

  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(intent.bucket).download(intent.storageKey);
  if (error || !data) {
    await markIntentFailure(intent.id, error?.message || "Uploaded object is missing");
    throw new Error("Uploaded object is missing");
  }

  try {
    await validateUploadedBlobMagicBytes(data, intent.expectedMimeType);
    const finalizedSize = normalizeAndValidateFileSize(data.size, Number.MAX_SAFE_INTEGER, "Upload");
    if (finalizedSize !== intent.expectedSize) {
      throw new Error("Uploaded object size does not match the declared size");
    }

    const [updated] = await db
      .update(uploadIntents)
      .set({
        status: "finalized",
        finalizedMimeType: intent.expectedMimeType,
        finalizedSize,
        finalizedAt: new Date(),
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(uploadIntents.id, intent.id))
      .returning();

    if (!updated) {
      throw new Error("Failed to finalize upload intent");
    }

    return updated;
  } catch (error) {
    await markIntentFailure(intent.id, error instanceof Error ? error.message : "Upload verification failed");
    throw error;
  }
}

export async function cleanupExpiredUploadIntents() {
  const expired = await db.query.uploadIntents.findMany({
    where: and(eq(uploadIntents.status, "pending"), lt(uploadIntents.expiresAt, new Date())),
  });

  if (expired.length === 0) {
    return { removedObjects: 0, expiredIntents: 0 };
  }

  const admin = await createAdminClient();
  let removedObjects = 0;
  for (const intent of expired) {
    const { error } = await admin.storage.from(intent.bucket).remove([intent.storageKey]);
    if (!error) {
      removedObjects += 1;
    }
  }

  await db
    .update(uploadIntents)
    .set({
      status: "expired",
      updatedAt: new Date(),
      failureReason: "Upload intent expired before finalization",
    })
    .where(and(eq(uploadIntents.status, "pending"), lt(uploadIntents.expiresAt, new Date())));

  return {
    removedObjects,
    expiredIntents: expired.length,
  };
}
