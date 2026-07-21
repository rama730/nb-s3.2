import crypto from "crypto";
import mime from "mime-types";

import { requireAuthenticatedUser, jsonSuccess, jsonError } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { projectNodes, fileVersions } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { getProjectFileContent } from "@/app/actions/files/content";
import { applyFileRevision } from "@/lib/files/apply-file-revision";
import { isFileRevisionMode, normalizeRevisionComment, parseFileRevisionMode } from "@/lib/files/revision-policy";
import { createAdminClient } from "@/lib/supabase/server";
import { parseProjectFileKey } from "@/lib/storage/project-file-key";
import { getProjectAccessById } from "@/lib/data/project-access";
import { logger } from "@/lib/logger";
import { checkIdempotencyKey, saveIdempotencyResult } from "@/lib/security/idempotency";
import { recordExtensionMetric } from "@/lib/extension/observability";
import {
  assertNoExtensionWriteConflict,
  buildExtensionRevisionStorageKey,
  extensionRevisionConflictResponse,
  extensionRevisionData,
  parseExtensionLeaseHeaders,
  resolveWritableExtensionFile,
} from "@/app/api/v1/extension/_file-revision";

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) {
      return authResult.response;
    }
    const user = authResult.user;
    if (!user) {
      return jsonError("Not authenticated", 401, "UNAUTHORIZED");
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId")?.trim();
    const path = searchParams.get("path")?.trim();
    const transfer = searchParams.get("transfer")?.trim();

    if (!projectId || !path) {
      return jsonError("Missing projectId or path", 400, "BAD_REQUEST");
    }

    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project) {
      return jsonError("Project not found", 404, "NOT_FOUND");
    }
    if (!access.canRead) {
      return jsonError("Forbidden", 403, "FORBIDDEN");
    }

    // Find the node
    const node = await db.query.projectNodes.findFirst({
      where: and(
        eq(projectNodes.projectId, projectId),
        eq(projectNodes.path, path),
        eq(projectNodes.type, "file"),
        isNull(projectNodes.deletedAt)
      )
    });

    if (!node) {
      return jsonError("File not found", 404, "NOT_FOUND");
    }

    const [version] = await Promise.all([
      db.query.fileVersions.findFirst({
        where: and(
          eq(fileVersions.nodeId, node.id),
          eq(fileVersions.version, node.currentVersion)
        ),
        columns: { contentHash: true },
      }),
    ]);

    if (transfer === "signed" && node.s3Key) {
      const parsedKey = parseProjectFileKey(node.s3Key);
      if (!parsedKey || parsedKey.projectId !== projectId) {
        return jsonError("File key does not belong to this project", 409, "CONFLICT");
      }
      const adminClient = await createAdminClient();
      const expiresInSeconds = 5 * 60;
      const { data, error } = await adminClient.storage
        .from("project-files")
        .createSignedUrl(node.s3Key, expiresInSeconds);
      if (error || !data?.signedUrl) {
        logger.error("[api/v1/extension/file] Signed download url failed", {
          error: error?.message || "missing signed url",
          projectId,
          nodeId: node.id,
        });
        return jsonError("Failed to create signed download URL", 500, "INTERNAL_ERROR");
      }

      recordExtensionMetric("extension.file.download_intent", {
        action: "download_intent",
        success: true,
        userId: user.id,
        projectId,
        nodeId: node.id,
        path,
        sizeBytes: node.size ?? 0,
      });

      return jsonSuccess({
        signedUrl: data.signedUrl,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
        nodeId: node.id,
        size: node.size,
        name: node.name,
        mimeType: node.mimeType,
        currentVersion: node.currentVersion,
        contentHash: version?.contentHash ?? null,
        updatedAt: node.updatedAt?.toISOString?.() ?? node.updatedAt,
      });
    }

    let contentBuffer: Buffer;
    if (node.s3Key) {
      const parsedKey = parseProjectFileKey(node.s3Key);
      if (!parsedKey || parsedKey.projectId !== projectId) {
        return jsonError("File key does not belong to this project", 409, "CONFLICT");
      }
      const adminClient = await createAdminClient();
      const { data, error } = await adminClient.storage.from("project-files").download(node.s3Key);
      if (error) {
        throw error;
      }
      contentBuffer = Buffer.from(await data.arrayBuffer());
    } else {
      const content = await getProjectFileContent(projectId, node.id);
      contentBuffer = Buffer.from(content, "utf8");
    }

    const range = parseByteRange(request.headers.get("range"), contentBuffer.byteLength);
    const sliced = range ? contentBuffer.subarray(range.start, range.end + 1) : contentBuffer;
    const body = JSON.stringify({
      success: true,
      data: {
        content: sliced.toString("base64"),
        encoding: "base64",
        range: range ? { ...range, total: contentBuffer.byteLength } : null,
        complete: !range,
        nodeId: node.id,
        size: node.size,
        name: node.name,
        mimeType: node.mimeType,
        currentVersion: node.currentVersion,
        contentHash: version?.contentHash ?? null,
        updatedAt: node.updatedAt?.toISOString?.() ?? node.updatedAt,
      }
    });

    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        "content-type": "application/json",
        "accept-ranges": "bytes",
        "x-nb-content-encoding": "base64",
      },
    });
  } catch (error) {
    logger.error("[api/v1/extension/file] Failed to get file content", {
      error: error instanceof Error ? error.message : String(error)
    });
    return jsonError("Failed to get file content", 500, "INTERNAL_ERROR");
  }
}

export async function PUT(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) {
      return authResult.response;
    }
    const user = authResult.user;
    if (!user) {
      return jsonError("Not authenticated", 401, "UNAUTHORIZED");
    }
    if (!authResult.extensionSessionId) {
      return jsonError("An active extension device session is required", 401, "UNAUTHORIZED");
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId")?.trim();
    const path = searchParams.get("path")?.trim();

    if (!projectId || !path) {
      return jsonError("Missing projectId or path", 400, "BAD_REQUEST");
    }

    const idempotencyScope = `${user.id}:${projectId}:${path}`;
    const idempotencyCheck = await checkIdempotencyKey(request, "extension.file.put", idempotencyScope);
    if (idempotencyCheck.isDuplicate) {
      if (idempotencyCheck.cachedResponse) {
        return new Response(idempotencyCheck.cachedResponse, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return jsonError("Request is already being processed", 409, "CONFLICT");
    }

    const savePayload = await readExtensionSavePayload(request);
    const revisionModeHeader = request.headers.get("x-nb-revision-mode")?.trim();
    if (revisionModeHeader && !isFileRevisionMode(revisionModeHeader)) {
      return jsonError("Invalid revision mode", 400, "BAD_REQUEST");
    }
    const revisionMode = parseFileRevisionMode(revisionModeHeader);
    const revisionComment = normalizeRevisionComment(
      request.headers.get("x-nb-revision-comment"),
    );
    const parsedLease = parseExtensionLeaseHeaders(request);
    if (parsedLease.response) return parsedLease.response;

    const resolved = await resolveWritableExtensionFile(projectId, path, user.id);
    if (resolved.response) return resolved.response;
    const node = resolved.node!;

    const baseVersionHeader = request.headers.get("x-nb-base-version")?.trim();
    const baseHashHeader = request.headers.get("x-nb-base-hash")?.trim();
    const baseVersion = baseVersionHeader ? Number(baseVersionHeader) : null;
    const validBaseVersion = baseVersion !== null && Number.isFinite(baseVersion) ? baseVersion : null;
    const conflict = await assertNoExtensionWriteConflict({
      node,
      baseVersion: validBaseVersion,
      baseHash: baseHashHeader || null,
    });
    if (conflict) return conflict;

    // Prepare upload metadata. Lease ownership is checked in the same
    // transaction as the revision write below.
    const contentHash = crypto.createHash("sha256").update(savePayload.buffer).digest("hex");
    const size = savePayload.buffer.byteLength;

    const s3Key = buildExtensionRevisionStorageKey(projectId, node.id, path, contentHash);
    const mimeType = savePayload.mimeType || inferMimeType(path);

    // 4. Upload to S3 storage via admin Supabase client
    const adminClient = await createAdminClient();
    const { error: uploadError } = await adminClient.storage
      .from("project-files")
      .upload(s3Key, savePayload.buffer, {
        contentType: mimeType,
        upsert: false
      });

    if (uploadError) {
      logger.error("[api/v1/extension/file] Storage upload failed", { error: uploadError.message });
      return jsonError(`Storage upload failed: ${uploadError.message}`, 500, "INTERNAL_ERROR");
    }

    let result;
    try {
      result = await applyFileRevision({
        projectId,
        nodeId: node.id,
        actorUserId: user.id,
        storageKey: s3Key,
        size,
        mimeType,
        contentHash,
        mode: revisionMode,
        comment: revisionComment,
        baseVersion: validBaseVersion,
        baseHash: baseHashHeader || null,
        lease: parsedLease.lease!,
        eventType: "extension_file_saved",
        eventMetadata: {
          transfer: "inline",
          operationId: request.headers.get("idempotency-key"),
        },
        syncStatus: "merged",
      });
    } catch (error) {
      await adminClient.storage.from("project-files").remove([s3Key]).catch(() => null);
      const conflictResponse = extensionRevisionConflictResponse(error);
      if (conflictResponse) return conflictResponse;
      throw error;
    }

    const successData = { success: true, ...extensionRevisionData(result, contentHash) };
    const successBody = JSON.stringify({ success: true, data: successData });
    await saveIdempotencyResult(request, "extension.file.put", successBody, idempotencyCheck.lockToken, idempotencyScope);

    recordExtensionMetric("extension.file.save", {
      action: "save",
      success: true,
      userId: user.id,
      projectId,
      nodeId: result.node.id,
      path,
      sizeBytes: size,
      revisionMode: result.mode,
      versionIncremented: result.versionIncremented,
    });

    return jsonSuccess(successData);
  } catch (error) {
    logger.error("[api/v1/extension/file] Failed to save file content", {
      error: error instanceof Error ? error.message : String(error)
    });
    return jsonError(
      "Failed to save file revision. Refresh the file and try again.",
      500,
      "INTERNAL_ERROR"
    );
  }
}

function parseByteRange(value: string | null, total: number): { start: number; end: number } | null {
  if (!value || total <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  start = Math.max(0, Math.min(total - 1, start));
  end = Math.max(start, Math.min(total - 1, end));
  return { start, end };
}

async function readExtensionSavePayload(request: Request): Promise<{ buffer: Buffer; mimeType: string | null }> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  const declaredEncoding = request.headers.get("x-nb-content-encoding")?.trim().toLowerCase() || "";
  const declaredMimeType = request.headers.get("x-nb-mime-type")?.trim() || null;

  if (declaredEncoding === "base64") {
    return { buffer: Buffer.from(await request.text(), "base64"), mimeType: declaredMimeType || contentType || null };
  }
  if (declaredEncoding === "binary" || contentType === "application/octet-stream") {
    return { buffer: Buffer.from(await request.arrayBuffer()), mimeType: declaredMimeType || contentType || null };
  }
  const text = await request.text();
  return { buffer: Buffer.from(text, "utf8"), mimeType: declaredMimeType || contentType || null };
}

function inferMimeType(path: string) {
  return mime.lookup(path) || "application/octet-stream";
}
