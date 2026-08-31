import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { importJobFiles, uploadIntents, type UploadIntent } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";
import {
  normalizeAndValidateFileSize,
  normalizeAndValidateMimeType,
  validateUploadedBlobMagicBytes,
} from "@/lib/upload/security";

const DEFAULT_UPLOAD_INTENT_TTL_MS = 60 * 60 * 1000;

export type UploadIntentScope = "project_file" | "project_update_media" | "profile_image";
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
    .where(and(eq(uploadIntents.id, intentId), eq(uploadIntents.status, "pending")));
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

export async function createUploadIntents(paramsList: Array<{
  userId: string;
  projectId?: string | null;
  bucket: string;
  storageKey: string;
  scope: UploadIntentScope;
  kind: UploadIntentKind;
  expectedMimeType: string;
  expectedSize: number;
  metadata?: Record<string, unknown>;
}>) {
  if (paramsList.length === 0) return [];
  const expiresAt = resolveUploadIntentExpiry();

  const values = paramsList.map(params => ({
      userId: params.userId,
      projectId: params.projectId ?? null,
      bucket: params.bucket,
      storageKey: params.storageKey,
      scope: params.scope,
      kind: params.kind,
      expectedMimeType: normalizeAndValidateMimeType(params.expectedMimeType),
      expectedSize: normalizeAndValidateFileSize(params.expectedSize, Number.MAX_SAFE_INTEGER, "Upload"),
      metadata: params.metadata ?? {},
      status: "pending" as const,
      expiresAt,
  }));

  const inserted = await db
    .insert(uploadIntents)
    .values(values)
    .onConflictDoUpdate({
      target: [uploadIntents.bucket, uploadIntents.storageKey],
      set: {
        userId: sql`EXCLUDED.user_id`,
        projectId: sql`EXCLUDED.project_id`,
        scope: sql`EXCLUDED.scope`,
        kind: sql`EXCLUDED.kind`,
        expectedMimeType: sql`EXCLUDED.expected_mime_type`,
        expectedSize: sql`EXCLUDED.expected_size`,
        metadata: sql`EXCLUDED.metadata`,
        status: sql`EXCLUDED.status`,
        failureReason: null,
        finalizedMimeType: null,
        finalizedSize: null,
        finalizedAt: null,
        expiresAt: sql`EXCLUDED.expires_at`,
        updatedAt: new Date(),
      },
    })
    .returning();

  return inserted;
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
  const bucket = admin.storage.from(intent.bucket);
  const { data: objectInfo, error: infoError } = await bucket.info(intent.storageKey);
  if (infoError || !objectInfo) {
    await markIntentFailure(intent.id, infoError?.message || "Uploaded object is missing");
    throw new Error("Uploaded object is missing");
  }

  try {
    const finalizedSize = normalizeAndValidateFileSize(objectInfo.size, Number.MAX_SAFE_INTEGER, "Upload");
    if (finalizedSize !== intent.expectedSize) {
      throw new Error("Uploaded object size does not match the declared size");
    }

    if (finalizedSize > 0) {
      const { data: signedData, error: signedError } = await bucket.createSignedUrl(intent.storageKey, 60);
      if (signedError || !signedData?.signedUrl) {
        throw signedError ?? new Error("Failed to verify uploaded object");
      }
      const signatureResponse = await fetch(signedData.signedUrl, {
        headers: { Range: "bytes=0-31" },
      });
      if (!signatureResponse.ok) {
        throw new Error(`Failed to verify uploaded object (${signatureResponse.status})`);
      }
      const signature = new Blob([await signatureResponse.arrayBuffer()], {
        type: intent.expectedMimeType,
      });
      await validateUploadedBlobMagicBytes(signature, intent.expectedMimeType);
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
      .where(and(
        eq(uploadIntents.id, intent.id),
        eq(uploadIntents.status, "pending"),
        sql`${uploadIntents.expiresAt} > now()`,
      ))
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

export async function finalizeUploadIntents(paramsList: Array<{
  bucket: string;
  storageKey: string;
  userId: string;
  projectId?: string | null;
  expectedScope?: UploadIntentScope;
  expectedKind?: UploadIntentKind;
}>) {
  const concurrency = 8;
  for (let index = 0; index < paramsList.length; index += concurrency) {
    await Promise.all(
      paramsList.slice(index, index + concurrency).map((params) => finalizeUploadIntent(params)),
    );
  }
}

export async function cleanupExpiredUploadIntents() {
  const now = new Date();
  const expired = await db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: uploadIntents.id,
        bucket: uploadIntents.bucket,
        storageKey: uploadIntents.storageKey,
      })
      .from(uploadIntents)
      .where(or(
        and(eq(uploadIntents.status, "pending"), lt(uploadIntents.expiresAt, now)),
        eq(uploadIntents.status, "expired"),
      ))
      .orderBy(asc(uploadIntents.expiresAt), asc(uploadIntents.id))
      .limit(100)
      .for("update", { skipLocked: true });
    if (candidates.length === 0) return [];

    await tx.update(uploadIntents)
      .set({
        status: "expired",
        updatedAt: now,
        failureReason: "Upload intent expired before finalization",
      })
      .where(inArray(uploadIntents.id, candidates.map((intent) => intent.id)));
    return candidates;
  });

  if (expired.length === 0) {
    return { removedObjects: 0, expiredIntents: 0, retryableIntents: 0 };
  }

  const admin = await createAdminClient();
  const byBucket = new Map<string, typeof expired>();
  for (const intent of expired) {
    const items = byBucket.get(intent.bucket) ?? [];
    items.push(intent);
    byBucket.set(intent.bucket, items);
  }

  const removedIds: string[] = [];
  const retryIds: string[] = [];
  for (const [bucket, intents] of byBucket) {
    const { error } = await admin.storage.from(bucket).remove(intents.map((intent) => intent.storageKey));
    if (error) {
      retryIds.push(...intents.map((intent) => intent.id));
    } else {
      removedIds.push(...intents.map((intent) => intent.id));
    }
  }

  await db.transaction(async (tx) => {
    if (retryIds.length > 0) {
      await tx.update(uploadIntents)
        .set({ status: "pending", updatedAt: new Date() })
        .where(and(eq(uploadIntents.status, "expired"), inArray(uploadIntents.id, retryIds)));
    }
    if (removedIds.length > 0) {
      await tx.update(importJobFiles)
        .set({ status: "failed", errorMessage: "Upload intent expired and cleaned up" })
        .where(inArray(importJobFiles.uploadIntentId, removedIds));
      await tx.delete(uploadIntents)
        .where(and(eq(uploadIntents.status, "expired"), inArray(uploadIntents.id, removedIds)));
    }
  });

  return {
    removedObjects: removedIds.length,
    expiredIntents: removedIds.length,
    retryableIntents: retryIds.length,
  };
}
