import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import {
  fileLeaseErrorResponse,
  leaseCredentialsSchema,
  leaseTtlMsSchema,
  requireFileLeaseUser,
  ttlMsToSeconds,
} from "@/app/api/v1/_file-lease-route";
import { db } from "@/lib/db";
import { projectNodes } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import {
  acquireFileLease,
  releaseFileLease,
  renewFileLease,
} from "@/lib/files/file-lock-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const baseSchema = z.object({
  projectId: z.string().uuid(),
  path: z.string().min(1).max(2_048),
  clientSessionId: z.string().uuid(),
});

const acquireSchema = baseSchema.extend({
  action: z.literal("acquire").optional().default("acquire"),
  ttlMs: leaseTtlMsSchema.optional(),
});

const ownedSchema = baseSchema.extend({
  action: z.enum(["renew", "release"]),
  ttlMs: leaseTtlMsSchema.optional(),
}).merge(leaseCredentialsSchema.omit({ sessionId: true }));

async function resolveEditableNode(projectId: string, path: string, userId: string) {
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
    columns: { id: true },
  });
  if (!node) return { error: jsonError("File not found", 404, "NOT_FOUND") };
  return { node };
}

export async function POST(request: Request) {
  try {
    const auth = await requireFileLeaseUser(request, { extensionSession: true });
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    const action = body && typeof body.action === "string" ? body.action : "acquire";
    const parsed = action === "acquire" ? acquireSchema.safeParse(body) : ownedSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid file lease request", 400, "BAD_REQUEST");
    const resolved = await resolveEditableNode(parsed.data.projectId, parsed.data.path, auth.user.id);
    if (resolved.error) return resolved.error;

    if (parsed.data.action === "acquire") {
      const lease = await acquireFileLease({
        projectId: parsed.data.projectId,
        nodeId: resolved.node!.id,
        userId: auth.user.id,
        sessionId: parsed.data.clientSessionId,
        clientKind: "vscode",
        deviceSessionId: auth.extensionSessionId,
        ttlSeconds: ttlMsToSeconds(parsed.data.ttlMs),
      });
      return jsonSuccess(lease);
    }

    if (parsed.data.action === "renew") {
      const lease = await renewFileLease({
        projectId: parsed.data.projectId,
        nodeId: resolved.node!.id,
        userId: auth.user.id,
        credentials: {
          leaseId: parsed.data.leaseId,
          sessionId: parsed.data.clientSessionId,
          fencingToken: parsed.data.fencingToken,
        },
        ttlSeconds: ttlMsToSeconds(parsed.data.ttlMs),
      });
      return jsonSuccess(lease);
    }

    const released = await releaseFileLease({
      projectId: parsed.data.projectId,
      nodeId: resolved.node!.id,
      userId: auth.user.id,
      credentials: {
        leaseId: parsed.data.leaseId,
        sessionId: parsed.data.clientSessionId,
        fencingToken: parsed.data.fencingToken,
      },
    });
    return jsonSuccess({ released, nodeId: resolved.node!.id });
  } catch (error) {
    return fileLeaseErrorResponse(error, "Failed to update file lease", {
      route: "[api/v1/extension/file-lock]",
    });
  }
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  return POST(new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({ ...(body || {}), action: "release" }),
  }));
}
