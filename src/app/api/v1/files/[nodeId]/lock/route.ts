import { z } from "zod";

import { jsonSuccess } from "@/app/api/v1/_envelope";
import {
  fileLeaseErrorResponse,
  leaseCredentialsSchema,
  leaseTtlSecondsSchema,
  parseFileLeaseBody,
  requireFileLeaseUser,
} from "@/app/api/v1/_file-lease-route";
import {
  acquireFileLease,
  releaseFileLease,
} from "@/lib/files/file-lock-service";
import { assertProjectWriteAccess } from "@/lib/files/internal-helpers";

const acquireSchema = z.object({
  projectId: z.string().uuid(),
  sessionId: z.string().uuid(),
  ttlSeconds: leaseTtlSecondsSchema.optional(),
});

const releaseSchema = z.object({
  projectId: z.string().uuid(),
}).merge(leaseCredentialsSchema);

export async function POST(
  request: Request,
  context: { params: Promise<{ nodeId: string }> },
) {
  try {
    const { nodeId } = await context.params;
    const auth = await requireFileLeaseUser(request, {
      csrf: true,
      rateLimit: { key: `api:v1:files:lock:${nodeId}`, limit: 120, windowSeconds: 60 },
    });
    if (auth.response) return auth.response;
    const parsed = await parseFileLeaseBody(request, acquireSchema, "Invalid request body");
    if (parsed.response) return parsed.response;
    await assertProjectWriteAccess(parsed.data.projectId, auth.user!.id);

    const lease = await acquireFileLease({
      projectId: parsed.data.projectId,
      nodeId,
      userId: auth.user!.id,
      sessionId: parsed.data.sessionId,
      clientKind: "web",
      ttlSeconds: parsed.data.ttlSeconds,
    });
    return jsonSuccess(lease);
  } catch (error) {
    return fileLeaseErrorResponse(error, "Failed to acquire file lease");
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ nodeId: string }> },
) {
  try {
    const { nodeId } = await context.params;
    const auth = await requireFileLeaseUser(request, {
      csrf: true,
      rateLimit: { key: `api:v1:files:lock-release:${nodeId}`, limit: 120, windowSeconds: 60 },
    });
    if (auth.response) return auth.response;
    const parsed = await parseFileLeaseBody(request, releaseSchema, "Invalid request body");
    if (parsed.response) return parsed.response;
    await assertProjectWriteAccess(parsed.data.projectId, auth.user!.id);
    const released = await releaseFileLease({
      projectId: parsed.data.projectId,
      nodeId,
      userId: auth.user!.id,
      credentials: parsed.data,
    });
    return jsonSuccess({ released });
  } catch (error) {
    return fileLeaseErrorResponse(error, "Failed to release file lease");
  }
}
