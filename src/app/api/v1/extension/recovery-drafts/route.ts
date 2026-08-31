import crypto from "node:crypto";

import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  enforceRouteLimit,
  jsonError,
  jsonSuccess,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { extensionRecoveryDrafts, extensionRecoverySessions, projectNodes } from "@/lib/db/schema";
import { getProjectAccessById, getProjectAccessByIds } from "@/lib/data/project-access";
import {
  deleteExtensionRecoveryDraftRows,
  EXTENSION_RECOVERY_BUCKET,
  MAX_RECOVERY_DRAFT_BYTES,
  pruneExtensionRecoveryGenerations,
  RECOVERY_DRAFT_RETENTION_DAYS,
} from "@/lib/extension/recovery-drafts";
import { recordExtensionMetric } from "@/lib/extension/observability";
import { recoveryIncidentReason } from "@/lib/extension/recovery-session-state";
import { resolveRecoverySessionsWithoutDrafts } from "@/lib/extension/recovery-sessions";
import { logger } from "@/lib/logger";
import { buildProjectFileKey, normalizeProjectFileRelativePath } from "@/lib/storage/project-file-key";
import { createAdminClient } from "@/lib/supabase/server";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const taskContextSchema = z.array(z.object({
  id: z.string().uuid(),
  title: z.string().max(300).optional(),
  taskNumber: z.number().int().nonnegative().nullable().optional(),
})).max(50).default([]);

const intentSchema = z.object({
  action: z.literal("intent"),
  projectId: z.string().uuid(),
  nodeId: z.string().uuid().optional().nullable(),
  path: z.string().min(1).max(1024),
  deviceId: z.string().min(8).max(160),
  sessionId: z.string().min(8).max(160),
  size: z.number().int().nonnegative().max(MAX_RECOVERY_DRAFT_BYTES),
  mimeType: z.enum(["text/plain", "application/json", "application/octet-stream"]).default("text/plain"),
  contentHash: checksumSchema,
  baseVersion: z.number().int().positive().optional().nullable(),
  baseHash: checksumSchema.optional().nullable(),
  taskContext: taskContextSchema,
  capturedAt: z.string().datetime(),
});

const finalizeSchema = z.object({
  action: z.literal("finalize"),
  draftId: z.string().uuid(),
  checksum: checksumSchema,
});

const deleteSchema = z.object({
  draftId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  path: z.string().min(1).max(1024).optional(),
  deviceId: z.string().min(8).max(160).optional(),
}).refine((value) => Boolean(value.draftId || (value.projectId && value.path)), {
  message: "draftId or projectId/path is required",
});

function storageKeyForDraft(userId: string, deviceId: string, draftId: string) {
  const deviceHash = crypto.createHash("sha256").update(deviceId).digest("hex").slice(0, 24);
  return `${userId}/${deviceHash}/${draftId}.draft`;
}

function normalizeRecoveryPath(projectId: string, path: string) {
  const relative = normalizeProjectFileRelativePath(path);
  buildProjectFileKey(projectId, relative);
  return `/${relative}`;
}

async function requireProjectAccess(projectId: string, userId: string, write: boolean) {
  const access = await getProjectAccessById(projectId, userId);
  if (!access.project) return jsonError("Project not found", 404, "NOT_FOUND");
  if (write ? !access.canWrite : !access.canRead) {
    return jsonError("Forbidden", 403, "FORBIDDEN");
  }
  return null;
}

async function createIntent(userId: string, body: z.infer<typeof intentSchema>) {
  const accessError = await requireProjectAccess(body.projectId, userId, true);
  if (accessError) return accessError;

  let filePath: string;
  try {
    filePath = normalizeRecoveryPath(body.projectId, body.path);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid path", 400, "BAD_REQUEST");
  }

  const node = await db.query.projectNodes.findFirst({
    where: and(
      eq(projectNodes.projectId, body.projectId),
      eq(projectNodes.path, filePath),
      eq(projectNodes.type, "file"),
      isNull(projectNodes.deletedAt),
    ),
    columns: { id: true },
  });
  if (!node || (body.nodeId && body.nodeId !== node.id)) {
    return jsonError("File node not found", 404, "NOT_FOUND");
  }

  const draftId = crypto.randomUUID();
  const storageKey = storageKeyForDraft(userId, body.deviceId, draftId);
  const capturedAt = new Date(body.capturedAt);
  const now = Date.now();
  if (
    capturedAt.getTime() > now + 5 * 60 * 1000
    || capturedAt.getTime() < now - RECOVERY_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ) {
    return jsonError("Recovery capture time is outside the retention window", 400, "BAD_REQUEST");
  }
  const expiresAt = new Date(capturedAt.getTime() + RECOVERY_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(extensionRecoveryDrafts).values({
    id: draftId,
    userId,
    projectId: body.projectId,
    nodeId: node.id,
    deviceId: body.deviceId,
    sessionId: body.sessionId,
    filePath,
    storageKey,
    size: body.size,
    mimeType: body.mimeType,
    contentHash: body.contentHash.toLowerCase(),
    baseVersion: body.baseVersion ?? null,
    baseHash: body.baseHash?.toLowerCase() ?? null,
    taskContext: body.taskContext,
    status: "pending",
    capturedAt,
    expiresAt,
  });

  const admin = await createAdminClient();
  const { data, error } = await admin.storage
    .from(EXTENSION_RECOVERY_BUCKET)
    .createSignedUploadUrl(storageKey, { upsert: false });
  if (error || !data) {
    await db.delete(extensionRecoveryDrafts).where(eq(extensionRecoveryDrafts.id, draftId));
    return jsonError("Could not prepare recovery upload", 503, "UNAVAILABLE");
  }

  recordExtensionMetric("extension.recovery.intent", {
    action: "intent",
    success: true,
    userId,
    projectId: body.projectId,
    nodeId: node.id,
    path: filePath,
    sizeBytes: body.size,
  });
  return jsonSuccess({
    draftId,
    signedUrl: data.signedUrl,
    uploadToken: data.token,
    storagePath: storageKey,
    bucket: EXTENSION_RECOVERY_BUCKET,
    contentType: body.mimeType,
    expiresAt: expiresAt.toISOString(),
  });
}

async function finalizeIntent(userId: string, body: z.infer<typeof finalizeSchema>) {
  const draft = await db.query.extensionRecoveryDrafts.findFirst({
    where: and(
      eq(extensionRecoveryDrafts.id, body.draftId),
      eq(extensionRecoveryDrafts.userId, userId),
    ),
  });
  if (!draft) return jsonError("Recovery draft not found", 404, "NOT_FOUND");
  if (draft.status === "finalized") return jsonSuccess({ draftId: draft.id, finalized: true });
  if (draft.status !== "pending" || draft.expiresAt.getTime() <= Date.now()) {
    return jsonError("Recovery upload is no longer usable", 409, "CONFLICT");
  }
  if (body.checksum.toLowerCase() !== draft.contentHash) {
    return jsonError("Recovery checksum does not match the intent", 400, "BAD_REQUEST");
  }

  const admin = await createAdminClient();
  const { data: info, error: infoError } = await admin.storage.from(EXTENSION_RECOVERY_BUCKET).info(draft.storageKey);
  if (infoError || !info) {
    await db.update(extensionRecoveryDrafts).set({
      status: "failed",
      failureReason: infoError?.message || "Uploaded object is missing",
      updatedAt: new Date(),
    }).where(eq(extensionRecoveryDrafts.id, draft.id));
    return jsonError("Uploaded recovery draft is missing", 400, "BAD_REQUEST");
  }
  if (info.size !== draft.size) {
    await db.update(extensionRecoveryDrafts).set({
      status: "failed",
      failureReason: "Uploaded object failed size validation",
      updatedAt: new Date(),
    }).where(eq(extensionRecoveryDrafts.id, draft.id));
    await admin.storage.from(EXTENSION_RECOVERY_BUCKET).remove([draft.storageKey]);
    return jsonError("Uploaded recovery draft failed validation", 400, "BAD_REQUEST");
  }

  const finalizedAt = new Date();
  await db.update(extensionRecoveryDrafts).set({
    status: "finalized",
    finalizedAt,
    failureReason: null,
    updatedAt: finalizedAt,
  }).where(eq(extensionRecoveryDrafts.id, draft.id));
  await pruneExtensionRecoveryGenerations({
    userId,
    deviceId: draft.deviceId,
    projectId: draft.projectId,
    filePath: draft.filePath,
  });

  recordExtensionMetric("extension.recovery.finalize", {
    action: "finalize",
    success: true,
    userId,
    projectId: draft.projectId,
    nodeId: draft.nodeId,
    path: draft.filePath,
    sizeBytes: draft.size,
  });
  return jsonSuccess({ draftId: draft.id, finalized: true, finalizedAt: finalizedAt.toISOString() });
}

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  const limited = await enforceRouteLimit(request, "api:v1:extension:recovery-drafts:write", 180, 60);
  if (limited) return limited;
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");

  try {
    const payload = await request.json();
    const intent = intentSchema.safeParse(payload);
    if (intent.success) return createIntent(auth.user.id, intent.data);
    const finalize = finalizeSchema.safeParse(payload);
    if (finalize.success) return finalizeIntent(auth.user.id, finalize.data);
    return jsonError("Invalid recovery draft request", 400, "BAD_REQUEST");
  } catch (error) {
    logger.error("extension.recovery.write.failed", {
      userId: auth.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    recordExtensionMetric("extension.recovery.write", {
      action: "write",
      success: false,
      userId: auth.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError("Could not save recovery draft", 500, "INTERNAL_ERROR");
  }
}

export async function GET(request: Request) {
  const limited = await enforceRouteLimit(request, "api:v1:extension:recovery-drafts:read", 60, 60);
  if (limited) return limited;
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");

  const url = new URL(request.url);
  const draftId = url.searchParams.get("draftId");
  if (draftId) {
    if (!z.string().uuid().safeParse(draftId).success) return jsonError("Invalid draft id", 400, "BAD_REQUEST");
    const row = await db.query.extensionRecoveryDrafts.findFirst({
      where: and(eq(extensionRecoveryDrafts.id, draftId), eq(extensionRecoveryDrafts.userId, auth.user.id)),
    });
    if (!row) return jsonError("Draft not found", 404, "NOT_FOUND");
    const accessError = await requireProjectAccess(row.projectId, auth.user.id, false);
    if (accessError) return accessError;
    const admin = await createAdminClient();
    const { data, error } = await admin.storage.from(EXTENSION_RECOVERY_BUCKET).createSignedUrl(row.storageKey, 5 * 60);
    if (error || !data?.signedUrl) return jsonError("Failed to sign URL", 500, "INTERNAL_ERROR");
    return jsonSuccess({ signedUrl: data.signedUrl });
  }

  const projectId = url.searchParams.get("projectId");
  const view = url.searchParams.get("view") === "incidents" ? "incidents" : "all";
  const currentSessionId = url.searchParams.get("currentSessionId");
  if (projectId && !z.string().uuid().safeParse(projectId).success) {
    return jsonError("Invalid project id", 400, "BAD_REQUEST");
  }
  if (currentSessionId && !z.string().uuid().safeParse(currentSessionId).success) {
    return jsonError("Invalid current session id", 400, "BAD_REQUEST");
  }
  if (projectId) {
    const accessError = await requireProjectAccess(projectId, auth.user.id, false);
    if (accessError) return accessError;
  }

  const rows = await db.select({
    draft: extensionRecoveryDrafts,
    sessionStatus: extensionRecoverySessions.status,
    sessionHeartbeat: extensionRecoverySessions.lastHeartbeatAt,
  }).from(extensionRecoveryDrafts)
    .leftJoin(extensionRecoverySessions, and(
      eq(extensionRecoverySessions.sessionId, extensionRecoveryDrafts.sessionId),
      eq(extensionRecoverySessions.userId, extensionRecoveryDrafts.userId),
    ))
    .where(and(
      eq(extensionRecoveryDrafts.userId, auth.user.id),
      eq(extensionRecoveryDrafts.status, "finalized"),
      gt(extensionRecoveryDrafts.expiresAt, new Date()),
      projectId ? eq(extensionRecoveryDrafts.projectId, projectId) : undefined,
    ))
    .orderBy(desc(extensionRecoveryDrafts.capturedAt), desc(extensionRecoveryDrafts.createdAt))
    .limit(200);

  const eligible = rows.map((row) => ({
    ...row,
    incidentReason: recoveryIncidentReason({
      draftSessionId: row.draft.sessionId,
      currentSessionId,
      sessionStatus: row.sessionStatus,
      lastHeartbeatAt: row.sessionHeartbeat,
    }),
  })).filter((row) => view === "all" || Boolean(row.incidentReason));

  const projectIds = Array.from(new Set(eligible.map((row) => row.draft.projectId)));
  const accessByProject = await getProjectAccessByIds(projectIds, auth.user.id);
  const visible = eligible.filter((row) => accessByProject[row.draft.projectId]?.canRead);
  
  const drafts = visible.map((row) => {
    const draft = row.draft;
    return {
      id: draft.id,
      projectId: draft.projectId,
      nodeId: draft.nodeId,
      deviceId: draft.deviceId,
      sessionId: draft.sessionId,
      path: draft.filePath,
      size: draft.size,
      mimeType: draft.mimeType,
      contentHash: draft.contentHash,
      baseVersion: draft.baseVersion,
      baseHash: draft.baseHash,
      taskContext: draft.taskContext,
      capturedAt: draft.capturedAt.toISOString(),
      expiresAt: draft.expiresAt.toISOString(),
      storageKey: draft.storageKey,
      source: "cloud" as const,
      incidentReason: row.incidentReason,
    };
  });

  if (view === "incidents") {
    recordExtensionMetric("extension.recovery.incidents", {
      action: "read",
      success: true,
      userId: auth.user.id,
      count: drafts.length,
    });
  }

  return jsonSuccess({ drafts });
}

export async function DELETE(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  const limited = await enforceRouteLimit(request, "api:v1:extension:recovery-drafts:delete", 60, 60);
  if (limited) return limited;
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid recovery draft delete request", 400, "BAD_REQUEST");
  let normalizedPath: string | undefined;
  if (parsed.data.path) {
    try {
      normalizedPath = normalizeRecoveryPath(parsed.data.projectId!, parsed.data.path);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Invalid path", 400, "BAD_REQUEST");
    }
  }

  const rows = await db
    .select({
      id: extensionRecoveryDrafts.id,
      storageKey: extensionRecoveryDrafts.storageKey,
      sessionId: extensionRecoveryDrafts.sessionId,
    })
    .from(extensionRecoveryDrafts)
    .where(and(
      eq(extensionRecoveryDrafts.userId, auth.user.id),
      parsed.data.draftId ? eq(extensionRecoveryDrafts.id, parsed.data.draftId) : undefined,
      parsed.data.projectId ? eq(extensionRecoveryDrafts.projectId, parsed.data.projectId) : undefined,
      normalizedPath ? eq(extensionRecoveryDrafts.filePath, normalizedPath) : undefined,
      parsed.data.deviceId ? eq(extensionRecoveryDrafts.deviceId, parsed.data.deviceId) : undefined,
    ));
  const deleted = await deleteExtensionRecoveryDraftRows(rows);
  const resolvedSessions = await resolveRecoverySessionsWithoutDrafts(
    auth.user.id,
    rows.map((row) => row.sessionId),
  );
  recordExtensionMetric("extension.recovery.incidents", {
    action: "resolve",
    success: true,
    userId: auth.user.id,
    count: resolvedSessions,
  });
  return jsonSuccess({ deleted, resolvedSessions });
}
