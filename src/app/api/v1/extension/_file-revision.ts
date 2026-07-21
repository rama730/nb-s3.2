import crypto from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { jsonError } from "@/app/api/v1/_shared";
import { leaseCredentialsSchema } from "@/app/api/v1/_file-lease-route";
import { db } from "@/lib/db";
import { fileVersions, projectNodes } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import type { ApplyFileRevisionResult } from "@/lib/files/apply-file-revision";
import { buildProjectFileKey } from "@/lib/storage/project-file-key";

export const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/i);

type ProjectNode = typeof projectNodes.$inferSelect;

export async function resolveWritableExtensionFile(projectId: string, path: string, userId: string) {
  const access = await getProjectAccessById(projectId, userId);
  if (!access.project) return { response: jsonError("Project not found", 404, "NOT_FOUND"), node: null };
  if (!access.canWrite) return { response: jsonError("Forbidden", 403, "FORBIDDEN"), node: null };

  const node = await db.query.projectNodes.findFirst({
    where: and(
      eq(projectNodes.projectId, projectId),
      eq(projectNodes.path, path),
      eq(projectNodes.type, "file"),
      isNull(projectNodes.deletedAt),
    ),
  });

  if (!node) return { response: jsonError("File node not found", 404, "NOT_FOUND"), node: null };
  return { response: null, node };
}

export async function assertNoExtensionWriteConflict(params: {
  node: ProjectNode;
  baseVersion?: number | null;
  baseHash?: string | null;
}) {
  if (params.baseVersion != null && params.baseVersion !== params.node.currentVersion) {
    return jsonError("File changed on the server. Refresh before saving again.", 409, "CONFLICT");
  }

  if (!params.baseHash) return null;
  const currentVersion = await db.query.fileVersions.findFirst({
    where: and(
      eq(fileVersions.nodeId, params.node.id),
      eq(fileVersions.version, params.node.currentVersion),
    ),
    columns: { contentHash: true },
  });
  if (currentVersion?.contentHash && currentVersion.contentHash !== params.baseHash) {
    return jsonError("File content changed on the server. Refresh before saving again.", 409, "CONFLICT");
  }
  return null;
}

export function parseExtensionLeaseHeaders(request: Request) {
  const parsed = leaseCredentialsSchema.safeParse({
    leaseId: request.headers.get("x-nb-lease-id")?.trim() || "",
    sessionId: request.headers.get("x-nb-client-session")?.trim() || "",
    fencingToken: Number(request.headers.get("x-nb-fencing-token")),
  });
  if (!parsed.success) return { response: jsonError("A valid editing lease is required", 409, "CONFLICT"), lease: null };
  return { response: null, lease: parsed.data };
}

export function parseExtensionLeaseMetadata(metadata: Record<string, unknown>) {
  const parsed = leaseCredentialsSchema.safeParse({
    leaseId: typeof metadata.leaseId === "string" ? metadata.leaseId : "",
    sessionId: typeof metadata.clientSessionId === "string" ? metadata.clientSessionId : "",
    fencingToken: typeof metadata.fencingToken === "number" ? metadata.fencingToken : Number(metadata.fencingToken),
  });
  return parsed.success ? parsed.data : null;
}

export function buildExtensionRevisionStorageKey(
  projectId: string,
  nodeId: string,
  path: string,
  contentHash: string,
) {
  const extension = path.split(".").pop()?.toLowerCase();
  const suffix = extension && /^[a-z0-9]{1,16}$/.test(extension) ? `.${extension}` : "";
  return buildProjectFileKey(
    projectId,
    `nodes/${nodeId}/versions/${contentHash}-${crypto.randomUUID()}${suffix}`,
  );
}

export function extensionRevisionData(result: ApplyFileRevisionResult, contentHash: string) {
  return {
    nodeId: result.node.id,
    version: result.version.version,
    size: result.node.size,
    mimeType: result.node.mimeType,
    contentHash,
    syncStatus: result.node.syncStatus,
    sequenceNumber: result.sequenceNumber,
    revisionMode: result.mode,
    versionIncremented: result.versionIncremented,
    updatedAt: result.node.updatedAt?.toISOString?.() ?? result.node.updatedAt,
  };
}

export function extensionRevisionConflictResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Failed to apply revision";
  return /changed on the server|locked by|editing lease|lease expired|lease was replaced/i.test(message)
    ? jsonError(message, 409, "CONFLICT")
    : null;
}
