import { requireAuthenticatedUser, jsonSuccess, jsonError } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { projectNodes, projectNodeLocks, profiles, fileVersions } from "@/lib/db/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import { getProjectFileContent } from "@/app/actions/files/content";
import { recordNodeEvent } from "@/lib/files/internal-helpers";
import { createAdminClient } from "@/lib/supabase/server";
import { buildProjectFileKey, parseProjectFileKey } from "@/lib/storage/project-file-key";
import { getProjectAccessById } from "@/lib/data/project-access";
import { logger } from "@/lib/logger";
import { checkIdempotencyKey, saveIdempotencyResult } from "@/lib/security/idempotency";
import { recordExtensionMetric } from "@/lib/extension/observability";
import crypto from "crypto";

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

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId")?.trim();
    const path = searchParams.get("path")?.trim();

    if (!projectId || !path) {
      return jsonError("Missing projectId or path", 400, "BAD_REQUEST");
    }

    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project) {
      return jsonError("Project not found", 404, "NOT_FOUND");
    }
    if (!access.canWrite) {
      return jsonError("Forbidden", 403, "FORBIDDEN");
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

    // 1. Find the node
    const node = await db.query.projectNodes.findFirst({
      where: and(
        eq(projectNodes.projectId, projectId),
        eq(projectNodes.path, path),
        eq(projectNodes.type, "file"),
        isNull(projectNodes.deletedAt)
      )
    });

    if (!node) {
      return jsonError("File node not found", 404, "NOT_FOUND");
    }

    const baseVersionHeader = request.headers.get("x-nb-base-version")?.trim();
    const baseHashHeader = request.headers.get("x-nb-base-hash")?.trim();
    const currentVersion = await db.query.fileVersions.findFirst({
      where: and(
        eq(fileVersions.nodeId, node.id),
        eq(fileVersions.version, node.currentVersion)
      ),
      columns: { contentHash: true },
    });
    const baseVersion = baseVersionHeader ? Number(baseVersionHeader) : null;
    if (baseVersion !== null && Number.isFinite(baseVersion) && baseVersion !== node.currentVersion) {
      return jsonError("File changed on the server. Refresh before saving again.", 409, "CONFLICT");
    }
    if (baseHashHeader && currentVersion?.contentHash && baseHashHeader !== currentVersion.contentHash) {
      return jsonError("File content changed on the server. Refresh before saving again.", 409, "CONFLICT");
    }

    // 2. Lock check: query project_node_locks to ensure no active lock conflict exists
    const activeLock = await db.query.projectNodeLocks.findFirst({
      where: and(
        eq(projectNodeLocks.projectId, projectId),
        eq(projectNodeLocks.nodeId, node.id),
        gt(projectNodeLocks.expiresAt, new Date())
      )
    });

    if (activeLock && activeLock.lockedBy !== user.id) {
      const lockHolder = await db.query.profiles.findFirst({
        where: eq(profiles.id, activeLock.lockedBy),
        columns: { fullName: true }
      });
      return jsonError(
        `File is locked by ${lockHolder?.fullName || "another collaborator"}.`,
        423,
        "CONFLICT"
      );
    }

    // 3. Prepare upload metadata
    const contentHash = crypto.createHash("sha256").update(savePayload.buffer).digest("hex");
    const size = savePayload.buffer.byteLength;

    const ext = path.split(".").pop()?.toLowerCase();
    const extensionSuffix = ext && /^[a-z0-9]+$/.test(ext) ? `.${ext}` : "";
    const s3Key = buildProjectFileKey(
      projectId,
      `nodes/${node.id}/versions/${contentHash}-${crypto.randomUUID()}${extensionSuffix}`
    );
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

    // 5. Atomic db updates inside transaction
    const result = await db.transaction(async (tx) => {
      const current = await tx.query.projectNodes.findFirst({
        where: eq(projectNodes.id, node.id),
        columns: { currentVersion: true }
      });
      const nextVersion = (current?.currentVersion ?? 1) + 1;

      const [versionRow] = await tx
        .insert(fileVersions)
        .values({
          nodeId: node.id,
          version: nextVersion,
          s3Key: s3Key,
          size: size,
          mimeType: mimeType,
          contentHash: contentHash,
          uploadedBy: user.id,
        })
        .returning();

      const [updatedNode] = await tx
        .update(projectNodes)
        .set({
          s3Key: s3Key,
          size: size,
          mimeType: mimeType,
          currentVersion: nextVersion,
          syncStatus: "merged",
          updatedAt: new Date()
        })
        .where(eq(projectNodes.id, node.id))
        .returning();

      const eventResult = await recordNodeEvent(projectId, user.id, node.id, "extension_file_saved", {
        version: nextVersion,
        size,
        mimeType,
        hash: contentHash,
      }, tx);

      return { node: updatedNode!, version: versionRow!, event: eventResult.event, sequenceNumber: eventResult.sequenceNumber };
    });

    const successData = {
      success: true,
      nodeId: result.node.id,
      version: result.version.version,
      size: result.node.size,
      mimeType: result.node.mimeType,
      contentHash,
      syncStatus: result.node.syncStatus,
      sequenceNumber: result.sequenceNumber,
      updatedAt: result.node.updatedAt?.toISOString?.() ?? result.node.updatedAt,
    };
    const successBody = JSON.stringify({ success: true, data: successData });
    await saveIdempotencyResult(request, "extension.file.put", successBody, idempotencyCheck.lockToken, idempotencyScope);

    return jsonSuccess(successData);
  } catch (error) {
    logger.error("[api/v1/extension/file] Failed to save file content", {
      error: error instanceof Error ? error.message : String(error)
    });
    return jsonError(
      error instanceof Error ? error.message : "Failed to save file content",
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
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "json") return "application/json";
  if (ext === "js" || ext === "jsx") return "application/javascript";
  if (ext === "md" || ext === "mdx") return "text/markdown";
  if (ext === "css") return "text/css";
  if (ext === "html") return "text/html";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "pdf") return "application/pdf";
  if (ext === "zip") return "application/zip";
  if (ext === "ts" || ext === "tsx" || ext === "txt" || ext === "yml" || ext === "yaml" || ext === "toml" || ext === "sql" || ext === "sh") return "text/plain";
  return "application/octet-stream";
}
